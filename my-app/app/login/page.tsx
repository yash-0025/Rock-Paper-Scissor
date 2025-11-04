"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FaPlay } from 'react-icons/fa';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const res = await fetch('http://localhost:4000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to log in');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('userId', data.userId);
      router.push('/');
      
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md p-8 space-y-6 bg-surface-light rounded-2xl shadow-xl">
        <div className="flex justify-center">
          <FaPlay className="text-accent-light text-5xl" />
        </div>
        <h1 className="text-3xl font-bold text-center">
          Welcome Back
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="submit"
            className="w-full p-3 bg-accent rounded-lg text-white font-semibold transition-transform duration-150
                       hover:bg-accent-dark active:scale-95 shadow-lg"
          >
            Login
          </button>
          {error && <p className="text-danger text-center text-sm">{error}</p>}
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          Don't have an account?{' '}
          <Link href="/signup" className="font-medium text-accent-light hover:underline">
            Sign Up
          </Link>
        </p>
      </div>
    </div>
  );
}