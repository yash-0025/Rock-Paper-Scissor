// client/lib/socket.ts
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const getSocket = (): Socket | null => {
  if (typeof window === 'undefined') return null;
  
  // If socket exists and is connected, return it
  if (socket?.connected) {
    return socket;
  }
  
  const token = localStorage.getItem('token');
  if (!token) return null;
  
  // Disconnect old socket if it exists but isn't connected
  if (socket) {
    socket.disconnect();
  }
  
  socket = io('http://localhost:4000', { 
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5
  });
  
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};