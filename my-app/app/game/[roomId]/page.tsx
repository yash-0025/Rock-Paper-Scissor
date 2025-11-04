"use client";

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { FaHandRock, FaHandPaper, FaHandScissors } from 'react-icons/fa';
import { getSocket } from '@/lib/socket';
import { Socket } from 'socket.io-client';

const ROUND_TIME = 8000;

type Player = { id: string; username: string };
type Scores = [number, number];
type Moves = [string | null, string | null];

export default function GameRoom() {
  const router = useRouter();
  const params = useParams();
  const roomId = params.roomId as string;
  
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const [players, setPlayers] = useState<Player[]>([]);
  const [scores, setScores] = useState<Scores>([0, 0]);
  const [round, setRound] = useState(0);
  const [myMove, setMyMove] = useState<string | null>(null);
  const [opponentMove, setOpponentMove] = useState<string | null>(null);
  const [roundResult, setRoundResult] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState<string | null>(null);
  const [timer, setTimer] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [postRoundTimer, setPostRoundTimer] = useState<number | null>(null);

  // Use ref to store latest values without triggering re-renders
  const playersRef = useRef<Player[]>([]);
  const myUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    myUserIdRef.current = myUserId;
  }, [myUserId]);

  const myPlayerIndex = players.findIndex((p) => p.id === myUserId);
  const opponentPlayerIndex = myPlayerIndex === 0 ? 1 : 0;

  useEffect(() => {
    const userId = localStorage.getItem('userId');
    if (!userId) {
      router.push('/login');
      return;
    }
    setMyUserId(userId);
    myUserIdRef.current = userId;
    
    const existingSocket = getSocket();
    if (!existingSocket) {
      router.push('/login');
      return;
    }
    setSocket(existingSocket);
  }, [router]);

  useEffect(() => {
    if (!socket || !roomId || !myUserId) return;

    console.log('Setting up game room listeners for room:', roomId);

    // Check if coming from matchmaking
    const fromMatchmaking = sessionStorage.getItem('inGame') === roomId;
    console.log('From matchmaking?', fromMatchmaking);
    
    // If NOT from matchmaking, join the room
    if (!fromMatchmaking) {
      console.log('Emitting join-room for:', roomId);
      socket.emit('join-room', { roomId });
    } else {
      // If from matchmaking, we're already in the room, so just mark as ready
      console.log('Already in room from matchmaking');
      setIsLoading(false);
    }

    const handleConnectError = (err: Error) => {
      console.error('Connection error:', err.message);
      if (err.message.includes('Authentication error')) {
        localStorage.removeItem('token');
        localStorage.removeItem('userId');
        router.push('/login');
      }
    };

    const handleGameStart = ({ players }: { players: Player[] }) => {
      console.log('Game starting with players:', players);
      setPlayers(players);
      playersRef.current = players;
      setScores([0, 0]);
      setGameOver(null);
      setIsLoading(false);
      sessionStorage.setItem('inGame', roomId);
    };

    const handleNewRound = ({ round }: { round: number }) => {
      console.log('New round:', round);
      setRound(round);
      setMyMove(null);
      setOpponentMove(null);
      setRoundResult(null);
      setTimer(ROUND_TIME / 1000);
      setPostRoundTimer(null);
    };

    const handleRoundResult = ({ winner, moves, scores, cooldownMs }: { winner: string, moves: Moves, scores: Scores, cooldownMs?: number }) => {
      console.log('Round result:', { winner, moves, scores });
      setScores(scores);
      
      const currentPlayers = playersRef.current;
      const currentMyUserId = myUserIdRef.current;
      const currentMyIndex = currentPlayers.findIndex((p) => p.id === currentMyUserId);
      const currentOpponentIndex = currentMyIndex === 0 ? 1 : 0;
      
      setMyMove(moves[currentMyIndex]);
      setOpponentMove(moves[currentOpponentIndex]);
      
      if (winner === 'draw') {
        setRoundResult('It\'s a Draw!');
      } else if (winner === `player${currentMyIndex + 1}`) {
        setRoundResult('You Win this Round!');
      } else {
        setRoundResult('You Lose this Round.');
      }

      // Start post-round countdown so UI shows next-round timer
      const seconds = Math.max(1, Math.ceil((cooldownMs ?? 3000) / 1000));
      setPostRoundTimer(seconds);
    };

    const handleGameOver = ({ winner }: { winner: string }) => {
      console.log('Game over, winner:', winner);
      const currentMyUserId = myUserIdRef.current;
      setGameOver(winner === currentMyUserId ? 'You Won the Game!' : 'You Lost the Game.');
      sessionStorage.removeItem('inGame');
    };
    
    const handleMoveConfirmed = () => {
      console.log('Move confirmed');
    };

    const handleOpponentLeft = () => {
      console.log('Opponent left');
      setGameOver('Your opponent disconnected. You win!');
      sessionStorage.removeItem('inGame');
    };

    const handleError = ({ message }: { message: string }) => {
      console.error('Socket error:', message);
      alert(message);
      sessionStorage.removeItem('inGame');
      router.push('/');
    };

    socket.on('connect_error', handleConnectError);
    socket.on('game-start', handleGameStart);
    socket.on('new-round', handleNewRound);
    socket.on('round-result', handleRoundResult);
    socket.on('game-over', handleGameOver);
    socket.on('move-confirmed', handleMoveConfirmed);
    socket.on('opponent-left', handleOpponentLeft);
    socket.on('error', handleError);

    return () => {
      console.log('Cleaning up game room listeners');
      socket.off('connect_error', handleConnectError);
      socket.off('game-start', handleGameStart);
      socket.off('new-round', handleNewRound);
      socket.off('round-result', handleRoundResult);
      socket.off('game-over', handleGameOver);
      socket.off('opponent-left', handleOpponentLeft);
      socket.off('error', handleError);
      socket.off('move-confirmed', handleMoveConfirmed);
    };
  }, [socket, roomId, myUserId, router]);

  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => {
        setTimer((t) => t - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  useEffect(() => {
    if (postRoundTimer && postRoundTimer > 0) {
      const interval = setInterval(() => {
        setPostRoundTimer((t) => (t ? t - 1 : null));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [postRoundTimer]);

  const handleMakeMove = (move: string) => {
    if (myMove === null && !gameOver && socket) {
      console.log('Making move:', move);
      setMyMove(move);
      socket.emit('make-move', { roomId, move });
    }
  };

  const getMoveIcon = (move: string | null) => {
    const iconClass = "text-7xl";
    if (move === 'rock') return <FaHandRock className={iconClass} />;
    if (move === 'paper') return <FaHandPaper className={iconClass} />;
    if (move === 'scissors') return <FaHandScissors className={iconClass} />;
    return <div className="w-[70px] h-[70px] border-4 border-surface-dark border-dashed rounded-full"></div>;
  };

  if (!myUserId || !socket) {
    return (
       <div className="flex flex-col items-center justify-center min-h-screen">
         <h1 className="text-2xl animate-pulse text-accent-light">Connecting to game...</h1>
       </div>
    );
  }

  if (gameOver) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h1 className="text-5xl font-bold mb-6">{gameOver}</h1>
        <button
          onClick={() => {
            sessionStorage.removeItem('inGame');
            router.push('/');
          }}
          className="px-8 py-3 text-xl font-semibold text-white bg-accent rounded-lg hover:bg-accent-dark"
        >
          Back to Lobby
        </button>
      </div>
    );
  }
  
  // Show loading or waiting for opponent
  if (isLoading || players.length < 2) {
    const inviteLink = typeof window !== 'undefined' 
      ? `${window.location.origin}/game/${roomId}`
      : `http://localhost:3000/game/${roomId}`;
      
    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
            <h1 className="text-3xl font-bold text-accent-light mb-4">
              {isLoading ? 'Loading game...' : 'Waiting for Opponent...'}
            </h1>
            {!isLoading && (
              <>
                <p className="text-slate-400 mb-6">Share this link to invite someone:</p>
                <input type="text" readOnly value={inviteLink} 
                       className="p-3 bg-surface-light rounded-lg w-full max-w-md text-center text-sm" 
                       onClick={(e) => e.currentTarget.select()}
                />
              </>
            )}
        </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-between min-h-screen p-4 md:p-8">
      
      <div className="w-full max-w-3xl p-6 bg-surface-light rounded-2xl shadow-xl">
        <h2 className="text-2xl font-bold text-center mb-6 text-accent-light">Round {round}</h2>
        <div className="flex justify-between items-center text-3xl font-bold">
          <div className="text-center">
            <span className="text-lg font-medium text-player">{players[myPlayerIndex]?.username || 'You'}</span>
            <div className="text-6xl">{scores[myPlayerIndex]}</div>
          </div>
          
          <div className="text-4xl text-slate-500">VS</div>

          <div className="text-center">
            <span className="text-lg font-medium text-opponent">{players[opponentPlayerIndex]?.username || 'Opponent'}</span>
            <div className="text-6xl">{scores[opponentPlayerIndex]}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center my-8">
        {roundResult ? (
          <>
            <h2 className="text-4xl font-bold text-warning">{roundResult}</h2>
            {postRoundTimer !== null && (
              <div className="mt-4 text-xl text-slate-300">
                Next round starting in <span className="font-bold">{postRoundTimer}s</span>
              </div>
            )}
          </>
        ) : (
          <div className="text-7xl font-bold">{timer}</div>
        )}
      </div>

      <div className="flex justify-around w-full max-w-3xl items-center">
        <div className="flex flex-col items-center">
          <span className="text-xl mb-4">Your Move</span>
          <div className="text-player">{getMoveIcon(myMove)}</div>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xl mb-4">Opponent's Move</span>
          <div className="text-opponent">
            {roundResult ? getMoveIcon(opponentMove) : getMoveIcon(null)}
          </div>
        </div>
      </div>

      <div className="flex space-x-4 md:space-x-8 mt-12">
        <button
          onClick={() => handleMakeMove('rock')}
          disabled={!!myMove}
          className="p-6 bg-blue-500 rounded-full transition-all duration-150 
                     hover:bg-blue-600 active:scale-90 shadow-lg disabled:bg-surface-medium disabled:opacity-50"
        >
          <FaHandRock size={40} />
        </button>
        <button
          onClick={() => handleMakeMove('paper')}
          disabled={!!myMove}
          className="p-6 bg-emerald-500 rounded-full transition-all duration-150 
                     hover:bg-emerald-600 active:scale-90 shadow-lg disabled:bg-surface-medium disabled:opacity-50"
        >
          <FaHandPaper size={40} />
        </button>
        <button
          onClick={() => handleMakeMove('scissors')}
          disabled={!!myMove}
          className="p-6 bg-red-500 rounded-full transition-all duration-150 
                     hover:bg-red-600 active:scale-90 shadow-lg disabled:bg-surface-medium disabled:opacity-50"
        >
          <FaHandScissors size={40} />
        </button>
      </div>
    </div>
  );
}