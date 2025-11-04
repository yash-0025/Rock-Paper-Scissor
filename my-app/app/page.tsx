"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FaUsers, FaPlus, FaSignOutAlt, FaHandRock } from 'react-icons/fa';
import { getSocket, disconnectSocket } from '@/lib/socket';
import { Socket } from 'socket.io-client';

export default function Home() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isFindingMatch, setIsFindingMatch] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('userId');
    
    if (token && userId) {
      setIsLoggedIn(true);
      
      const newSocket = getSocket();
      setSocket(newSocket);

      if (newSocket) {
        newSocket.on('connect', () => {
          console.log('Connected to server:', newSocket.id);
        });

        newSocket.on('connect_error', (err) => {
          console.error('Connection error:', err.message);
          if (err.message.includes('Authentication error')) {
            handleLogout();
          }
        });
        
        newSocket.on('room-created', ({ roomId }: { roomId: string }) => {
          console.log('Room created:', roomId);
          router.push(`/game/${roomId}`);
        });
        
        // Listen for match-found event for random matchmaking
        newSocket.on('match-found', ({ roomId, players }: { roomId: string; players: any[] }) => {
          console.log('Match found! Room:', roomId, 'Players:', players);
          setIsFindingMatch(false);
          // Store that we're in a game from matchmaking
          sessionStorage.setItem('inGame', roomId);
          // Navigate to game room
          router.push(`/game/${roomId}`);
        });
        
        newSocket.on('waiting-for-match', () => {
          console.log('Waiting for opponent...');
          setIsFindingMatch(true);
        });
      }
      
      return () => {
        if (newSocket) {
          newSocket.off('connect');
          newSocket.off('connect_error');
          newSocket.off('room-created');
          newSocket.off('match-found');
          newSocket.off('waiting-for-match');
        }
      };
    }
  }, [router]);

  const handleCreateRoom = () => {
    if (socket) {
      console.log('Creating private room...');
      socket.emit('create-room');
    }
  };
  
  const handleFindMatch = () => {
    if (socket) {
      console.log('Finding random match...');
      setIsFindingMatch(true);
      socket.emit('find-random-match');
    }
  };
  
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    sessionStorage.clear();
    setIsLoggedIn(false);
    disconnectSocket();
    setSocket(null);
  };

  // --- Render Login/Signup buttons ---
  if (!isLoggedIn) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
        <FaHandRock className="text-accent-light text-7xl mb-6" />
        <h1 className="text-5xl font-bold mb-4">Rock Paper Scissors</h1>
        <p className="text-lg text-slate-400 mb-10 max-w-md">
          Log in or sign up to challenge players in real-time.
        </p>
        <div className="flex gap-4">
          <Link href="/login" className="px-6 py-3 bg-accent text-white font-semibold rounded-lg text-lg 
                                       hover:bg-accent-dark shadow-lg transition-transform hover:scale-105">
            Login
          </Link>
          <Link href="/signup" className="px-6 py-3 bg-surface-medium text-white font-semibold rounded-lg text-lg 
                                        hover:bg-surface-dark shadow-lg transition-transform hover:scale-105">
            Sign Up
          </Link>
        </div>
      </main>
    );
  }

  // --- Render Lobby ---
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-5xl font-bold mb-12">Main Lobby</h1>
      {isFindingMatch ? (
        <div className="flex flex-col items-center gap-4">
          <div className="text-2xl text-accent-light animate-pulse">
            Waiting for opponent...
          </div>
          <button
            onClick={() => setIsFindingMatch(false)}
            className="px-4 py-2 text-sm bg-surface-medium rounded-lg hover:bg-surface-dark"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-6 w-full max-w-sm">
          <button
            onClick={handleFindMatch}
            className="flex items-center justify-center gap-3 px-8 py-4 bg-accent text-white font-bold rounded-lg text-2xl 
                       transition-all duration-150 hover:bg-accent-dark active:scale-95 shadow-lg hover:shadow-indigo-500/50"
          >
            <FaUsers />
            Find Random Match
          </button>
          <button
            onClick={handleCreateRoom}
            className="flex items-center justify-center gap-3 px-8 py-4 bg-transparent border-2 border-accent text-accent-light 
                       font-bold rounded-lg text-2xl transition-all duration-150 hover:bg-accent/20 active:scale-95"
          >
            <FaPlus />
            Create Private Room
          </button>
        </div>
      )}
      <button
        onClick={handleLogout}
        className="absolute top-6 right-6 flex items-center gap-2 px-4 py-2 bg-danger text-white 
                   rounded-lg hover:opacity-90 transition-all text-sm font-medium"
      >
        <FaSignOutAlt />
        Logout
      </button>
    </main>
  );
}