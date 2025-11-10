import React, { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";

interface LoadingOverlayProps {
  visible: boolean;
  minDuration?: number; // Minimum display duration in milliseconds
  message?: string;
  showLogo?: boolean;
  className?: string;
  backgroundColor?: string;
}

export function LoadingOverlay({
  visible,
  minDuration = 800,
  message,
  showLogo = true,
  className,
  backgroundColor,
}: LoadingOverlayProps) {
  const [isShowing, setIsShowing] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [animationType, setAnimationType] = useState<
    "glitch" | "breathe" | "typewriter" | "scanner" | "pulse"
  >("glitch");
  const showStartTimeRef = useRef<number | null>(null);
  const minDurationTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (visible) {
      // Randomly choose animation type from 5 options
      const animations: (
        | "glitch"
        | "breathe"
        | "typewriter"
        | "scanner"
        | "pulse"
      )[] = ["glitch", "breathe", "typewriter", "scanner", "pulse"];
      const randomIndex = Math.floor(Math.random() * 5);
      setAnimationType(animations[randomIndex]);

      // Start showing immediately
      setIsShowing(true);
      setIsFadingOut(false);
      showStartTimeRef.current = Date.now();

      // Clear any existing timer
      if (minDurationTimerRef.current) {
        clearTimeout(minDurationTimerRef.current);
        minDurationTimerRef.current = null;
      }
    } else if (isShowing) {
      // Calculate how long it has been showing
      const elapsed = showStartTimeRef.current
        ? Date.now() - showStartTimeRef.current
        : 0;
      const remaining = Math.max(0, minDuration - elapsed);

      if (remaining > 0) {
        // Wait for minimum duration before hiding
        minDurationTimerRef.current = setTimeout(() => {
          setIsFadingOut(true);
          // Wait for fade-out animation to complete
          setTimeout(() => {
            setIsShowing(false);
            setIsFadingOut(false);
            showStartTimeRef.current = null;
          }, 300); // Match fade-out duration
        }, remaining);
      } else {
        // Minimum duration already passed, hide immediately
        setIsFadingOut(true);
        setTimeout(() => {
          setIsShowing(false);
          setIsFadingOut(false);
          showStartTimeRef.current = null;
        }, 300);
      }
    }

    return () => {
      if (minDurationTimerRef.current) {
        clearTimeout(minDurationTimerRef.current);
        minDurationTimerRef.current = null;
      }
    };
  }, [visible, isShowing, minDuration]);

  if (!isShowing) {
    return null;
  }

  return (
    <>
      <style>
        {`
          @keyframes glitch-main {
            0%, 20%, 40%, 60%, 80%, 100% {
              transform: translate(0);
              filter: none;
            }
            2% {
              transform: translate(-8px, 0);
              filter: hue-rotate(90deg);
            }
            4% {
              transform: translate(-8px, 0);
              filter: hue-rotate(90deg);
            }
            22% {
              transform: translate(8px, 0) skew(-5deg);
            }
            24% {
              transform: translate(8px, 0) skew(-5deg);
            }
            42% {
              transform: translate(-6px, 0);
              filter: blur(2px);
            }
            44% {
              transform: translate(-6px, 0);
              filter: blur(2px);
            }
            62% {
              transform: translate(10px, 0) skew(8deg);
              filter: saturate(3);
            }
            64% {
              transform: translate(10px, 0) skew(8deg);
              filter: saturate(3);
            }
            82% {
              transform: translate(-4px, 0);
            }
            84% {
              transform: translate(-4px, 0);
            }
          }

          @keyframes glitch-before {
            0%, 100% {
              clip-path: polygon(0 0, 100% 0, 100% 5%, 0 5%);
              transform: translate(-8px, 0) skew(-3deg);
            }
            10% {
              clip-path: polygon(0 15%, 100% 15%, 100% 20%, 0 20%);
              transform: translate(6px, 0) skew(2deg);
            }
            20% {
              clip-path: polygon(0 35%, 100% 35%, 100% 40%, 0 40%);
              transform: translate(-4px, 0) skew(-1deg);
            }
            30% {
              clip-path: polygon(0 50%, 100% 50%, 100% 60%, 0 60%);
              transform: translate(10px, 0) skew(4deg);
            }
            40% {
              clip-path: polygon(0 70%, 100% 70%, 100% 75%, 0 75%);
              transform: translate(-6px, 0) skew(-2deg);
            }
            50% {
              clip-path: polygon(0 80%, 100% 80%, 100% 90%, 0 90%);
              transform: translate(8px, 0) skew(3deg);
            }
            60% {
              clip-path: polygon(0 10%, 100% 10%, 100% 15%, 0 15%);
              transform: translate(-7px, 0) skew(-3deg);
            }
            70% {
              clip-path: polygon(0 25%, 100% 25%, 100% 35%, 0 35%);
              transform: translate(5px, 0) skew(2deg);
            }
            80% {
              clip-path: polygon(0 45%, 100% 45%, 100% 55%, 0 55%);
              transform: translate(-9px, 0) skew(-4deg);
            }
            90% {
              clip-path: polygon(0 65%, 100% 65%, 100% 70%, 0 70%);
              transform: translate(7px, 0) skew(2deg);
            }
          }

          @keyframes glitch-after {
            0%, 100% {
              clip-path: polygon(0 80%, 100% 80%, 100% 90%, 0 90%);
              transform: translate(7px, 0) skew(2deg);
            }
            10% {
              clip-path: polygon(0 10%, 100% 10%, 100% 20%, 0 20%);
              transform: translate(-5px, 0) skew(-3deg);
            }
            20% {
              clip-path: polygon(0 30%, 100% 30%, 100% 35%, 0 35%);
              transform: translate(8px, 0) skew(4deg);
            }
            30% {
              clip-path: polygon(0 50%, 100% 50%, 100% 65%, 0 65%);
              transform: translate(-6px, 0) skew(-2deg);
            }
            40% {
              clip-path: polygon(0 5%, 100% 5%, 100% 15%, 0 15%);
              transform: translate(9px, 0) skew(3deg);
            }
            50% {
              clip-path: polygon(0 70%, 100% 70%, 100% 80%, 0 80%);
              transform: translate(-7px, 0) skew(-4deg);
            }
            60% {
              clip-path: polygon(0 40%, 100% 40%, 100% 50%, 0 50%);
              transform: translate(6px, 0) skew(2deg);
            }
            70% {
              clip-path: polygon(0 20%, 100% 20%, 100% 30%, 0 30%);
              transform: translate(-8px, 0) skew(-3deg);
            }
            80% {
              clip-path: polygon(0 60%, 100% 60%, 100% 70%, 0 70%);
              transform: translate(5px, 0) skew(2deg);
            }
            90% {
              clip-path: polygon(0 0%, 100% 0%, 100% 10%, 0 10%);
              transform: translate(-10px, 0) skew(-4deg);
            }
          }

          @keyframes flicker {
            0%, 100% {
              opacity: 1;
            }
            31.98%, 32.98%, 34.98%, 36.98% {
              opacity: 1;
            }
            32%, 34%, 36% {
              opacity: 0.4;
            }
            32.8%, 34.8%, 36.8% {
              opacity: 1;
            }
            32.82%, 34.82%, 36.82% {
              opacity: 0.4;
            }
            32.92%, 34.92%, 36.92% {
              opacity: 1;
            }
          }

          @keyframes rgb-shift {
            0%, 100% {
              text-shadow:
                0.05em 0 0 rgba(255, 0, 0, 0.75),
                -0.025em -0.05em 0 rgba(0, 255, 0, 0.75),
                0.025em 0.05em 0 rgba(0, 0, 255, 0.75);
            }
            14% {
              text-shadow:
                0.05em 0 0 rgba(255, 0, 0, 0.75),
                -0.025em -0.05em 0 rgba(0, 255, 0, 0.75),
                0.025em 0.05em 0 rgba(0, 0, 255, 0.75);
            }
            15% {
              text-shadow:
                -0.05em -0.025em 0 rgba(255, 0, 0, 0.75),
                0.025em 0.025em 0 rgba(0, 255, 0, 0.75),
                -0.05em -0.05em 0 rgba(0, 0, 255, 0.75);
            }
            49% {
              text-shadow:
                -0.05em -0.025em 0 rgba(255, 0, 0, 0.75),
                0.025em 0.025em 0 rgba(0, 255, 0, 0.75),
                -0.05em -0.05em 0 rgba(0, 0, 255, 0.75);
            }
            50% {
              text-shadow:
                0.025em 0.05em 0 rgba(255, 0, 0, 0.75),
                0.05em 0 0 rgba(0, 255, 0, 0.75),
                0 -0.05em 0 rgba(0, 0, 255, 0.75);
            }
            99% {
              text-shadow:
                0.025em 0.05em 0 rgba(255, 0, 0, 0.75),
                0.05em 0 0 rgba(0, 255, 0, 0.75),
                0 -0.05em 0 rgba(0, 0, 255, 0.75);
            }
          }

          .glitch-container {
            position: relative;
            animation: glitch-main 2s steps(1, end) infinite;
          }

          .glitch-text {
            position: relative;
            color: #fff;
            z-index: 1;
            animation:
              flicker 4s infinite,
              rgb-shift 0.6s infinite;
          }

          .glitch-text::before,
          .glitch-text::after {
            content: 'TERMIX';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: transparent;
            mix-blend-mode: screen;
          }

          .glitch-text::before {
            left: 0;
            text-shadow: -3px 0 #00ffff;
            animation: glitch-before 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite;
            color: transparent;
            z-index: -1;
          }

          .glitch-text::after {
            left: 0;
            text-shadow: 3px 0 #ff00de;
            animation: glitch-after 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite;
            color: transparent;
            z-index: -2;
          }

          @keyframes scan-line {
            0% {
              top: -10%;
            }
            100% {
              top: 110%;
            }
          }

          .scan-line {
            position: absolute;
            width: 100%;
            height: 3px;
            background: linear-gradient(
              to bottom,
              transparent,
              rgba(0, 255, 255, 0.6) 40%,
              rgba(255, 255, 255, 0.9) 50%,
              rgba(255, 0, 222, 0.6) 60%,
              transparent
            );
            animation: scan-line 3s linear infinite;
            z-index: 10;
            box-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
          }

          @keyframes noise {
            0%, 100% { background-position: 0 0; }
            10% { background-position: -5% -10%; }
            20% { background-position: -15% 5%; }
            30% { background-position: 7% -25%; }
            40% { background-position: 20% 25%; }
            50% { background-position: -25% 10%; }
            60% { background-position: 15% 5%; }
            70% { background-position: 0% 15%; }
            80% { background-position: 25% 35%; }
            90% { background-position: -10% 10%; }
          }

          .noise-overlay {
            position: absolute;
            inset: 0;
            opacity: 0.05;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' /%3E%3C/svg%3E");
            animation: noise 1s steps(2) infinite;
            pointer-events: none;
          }

          @keyframes glitch-blocks {
            0%, 100% {
              opacity: 0;
            }
            33% {
              opacity: 0;
            }
            33.3% {
              opacity: 1;
            }
            33.6% {
              opacity: 0;
            }
            66% {
              opacity: 0;
            }
            66.3% {
              opacity: 1;
            }
            66.6% {
              opacity: 0;
            }
          }

          .glitch-blocks {
            position: absolute;
            inset: 0;
            pointer-events: none;
            animation: glitch-blocks 5s infinite;
          }

          .glitch-blocks::before,
          .glitch-blocks::after {
            content: '';
            position: absolute;
            width: 100%;
            height: 10%;
            background: rgba(255, 255, 255, 0.1);
            left: 0;
          }

          .glitch-blocks::before {
            top: 20%;
            animation: glitch-block-1 3s infinite;
          }

          .glitch-blocks::after {
            top: 60%;
            animation: glitch-block-2 2.5s infinite;
          }

          @keyframes glitch-block-1 {
            0%, 100% {
              transform: translateX(0);
            }
            33% {
              transform: translateX(-100%);
            }
            33.3% {
              transform: translateX(100%);
            }
            66% {
              transform: translateX(0);
            }
          }

          @keyframes glitch-block-2 {
            0%, 100% {
              transform: translateX(0);
            }
            25% {
              transform: translateX(100%);
            }
            25.3% {
              transform: translateX(-100%);
            }
            50% {
              transform: translateX(0);
            }
          }

          /* Enhanced Glitch Fullscreen Effects */
          @keyframes rgb-split-bg {
            0%, 100% {
              transform: translate(0, 0);
            }
            33% {
              transform: translate(-10px, 5px);
            }
            66% {
              transform: translate(10px, -5px);
            }
          }

          @keyframes signal-distort {
            0%, 100% {
              clip-path: inset(0 0 0 0);
            }
            10% {
              clip-path: inset(20% 0 0 0);
            }
            20% {
              clip-path: inset(0 0 30% 0);
            }
            30% {
              clip-path: inset(40% 0 0 0);
            }
            40% {
              clip-path: inset(0 0 50% 0);
            }
            50% {
              clip-path: inset(0 0 0 0);
            }
          }

          .glitch-fullscreen {
            position: absolute;
            inset: 0;
            overflow: hidden;
            background: transparent;
          }

          .rgb-split-layers {
            position: absolute;
            inset: 0;
            pointer-events: none;
          }

          .rgb-layer {
            position: absolute;
            inset: 0;
            mix-blend-mode: screen;
            animation: rgb-split-bg 0.5s steps(1, end) infinite;
          }

          .rgb-layer.red {
            background: radial-gradient(circle at 30% 40%, rgba(255, 0, 100, 0.15) 0%, transparent 50%);
            animation-delay: 0s;
          }

          .rgb-layer.green {
            background: radial-gradient(circle at 70% 60%, rgba(0, 255, 100, 0.15) 0%, transparent 50%);
            animation-delay: 0.1s;
          }

          .rgb-layer.blue {
            background: radial-gradient(circle at 50% 50%, rgba(0, 100, 255, 0.15) 0%, transparent 50%);
            animation-delay: 0.2s;
          }

          .signal-bars {
            position: absolute;
            inset: 0;
            pointer-events: none;
            animation: signal-distort 4s steps(1, end) infinite;
          }

          .signal-bar {
            position: absolute;
            width: 100%;
            height: 3px;
            background: rgba(255, 255, 255, 0.1);
            animation: signal-distort 3s steps(1, end) infinite;
          }

          .signal-bar:nth-child(1) { top: 20%; animation-delay: 0s; }
          .signal-bar:nth-child(2) { top: 40%; animation-delay: 0.5s; }
          .signal-bar:nth-child(3) { top: 60%; animation-delay: 1s; }
          .signal-bar:nth-child(4) { top: 80%; animation-delay: 1.5s; }

          /* Breathe Animation Styles - Elegant Dream Theme */
          @keyframes breathe-glow {
            0%, 100% {
              text-shadow:
                0 0 20px rgba(59, 130, 246, 0.8),
                0 0 40px rgba(59, 130, 246, 0.6),
                0 0 60px rgba(59, 130, 246, 0.4),
                0 0 80px rgba(59, 130, 246, 0.3),
                0 0 100px rgba(59, 130, 246, 0.2);
              filter: brightness(1.1);
              transform: scale(1);
            }
            50% {
              text-shadow:
                0 0 30px rgba(59, 130, 246, 1),
                0 0 60px rgba(59, 130, 246, 0.8),
                0 0 90px rgba(59, 130, 246, 0.6),
                0 0 120px rgba(59, 130, 246, 0.4),
                0 0 150px rgba(59, 130, 246, 0.3);
              filter: brightness(1.3);
              transform: scale(1.05);
            }
          }

          @keyframes float-particle {
            0%, 100% {
              transform: translate(0, 0) scale(1);
              opacity: 0.3;
            }
            25% {
              transform: translate(var(--dx1), var(--dy1)) scale(1.2);
              opacity: 0.6;
            }
            50% {
              transform: translate(var(--dx2), var(--dy2)) scale(0.8);
              opacity: 0.4;
            }
            75% {
              transform: translate(var(--dx3), var(--dy3)) scale(1.1);
              opacity: 0.5;
            }
          }

          @keyframes bg-gradient-shift {
            0%, 100% {
              background-position: 0% 50%;
            }
            50% {
              background-position: 100% 50%;
            }
          }

          .breathe-fullscreen {
            position: absolute;
            inset: 0;
            overflow: hidden;
            background: radial-gradient(ellipse at 30% 40%, rgba(59, 130, 246, 0.15) 0%, transparent 50%),
                        radial-gradient(ellipse at 70% 60%, rgba(139, 92, 246, 0.15) 0%, transparent 50%),
                        radial-gradient(ellipse at 50% 50%, rgba(6, 182, 212, 0.1) 0%, transparent 60%);
            background-size: 200% 200%;
            animation: bg-gradient-shift 10s ease-in-out infinite;
          }

          .breathe-particles-field {
            position: absolute;
            inset: 0;
            pointer-events: none;
          }

          .float-particle {
            position: absolute;
            width: 8px;
            height: 8px;
            background: radial-gradient(circle, rgba(59, 130, 246, 0.8) 0%, transparent 70%);
            border-radius: 50%;
            animation: float-particle 12s ease-in-out infinite;
            box-shadow: 0 0 15px rgba(59, 130, 246, 0.6);
          }

          .float-particle:nth-child(1) { left: 10%; top: 20%; --dx1: 60px; --dy1: -80px; --dx2: -40px; --dy2: 60px; --dx3: 20px; --dy3: -30px; animation-delay: 0s; }
          .float-particle:nth-child(2) { left: 20%; top: 60%; --dx1: -50px; --dy1: -60px; --dx2: 70px; --dy2: 40px; --dx3: -30px; --dy3: -50px; animation-delay: -2s; }
          .float-particle:nth-child(3) { left: 80%; top: 30%; --dx1: -60px; --dy1: 70px; --dx2: 40px; --dy2: -80px; --dx3: -20px; --dy3: 40px; animation-delay: -4s; }
          .float-particle:nth-child(4) { left: 70%; top: 70%; --dx1: 50px; --dy1: 60px; --dx2: -60px; --dy2: -40px; --dx3: 30px; --dy3: 50px; animation-delay: -6s; }
          .float-particle:nth-child(5) { left: 40%; top: 15%; --dx1: -70px; --dy1: 50px; --dx2: 60px; --dy2: -60px; --dx3: -40px; --dy3: 30px; animation-delay: -1s; }
          .float-particle:nth-child(6) { left: 60%; top: 85%; --dx1: 40px; --dy1: -70px; --dx2: -50px; --dy2: 50px; --dx3: 60px; --dy3: -40px; animation-delay: -3s; }
          .float-particle:nth-child(7) { left: 15%; top: 80%; --dx1: 70px; --dy1: -50px; --dx2: -60px; --dy2: 70px; --dx3: 40px; --dy3: -60px; animation-delay: -5s; }
          .float-particle:nth-child(8) { left: 85%; top: 50%; --dx1: -40px; --dy1: 60px; --dx2: 50px; --dy2: -50px; --dx3: -70px; --dy3: 40px; animation-delay: -7s; }
          .float-particle:nth-child(9) { left: 50%; top: 10%; --dx1: 30px; --dy1: 80px; --dx2: -70px; --dy2: -30px; --dx3: 50px; --dy3: 60px; animation-delay: -8s; }
          .float-particle:nth-child(10) { left: 30%; top: 90%; --dx1: -80px; --dy1: -40px; --dx2: 60px; --dy2: 60px; --dx3: -50px; --dy3: -70px; animation-delay: -9s; }
          .float-particle:nth-child(11) { left: 90%; top: 80%; --dx1: 60px; --dy1: 40px; --dx2: -80px; --dy2: -60px; --dx3: 70px; --dy3: 50px; animation-delay: -10s; }
          .float-particle:nth-child(12) { left: 5%; top: 40%; --dx1: -50px; --dy1: -70px; --dx2: 80px; --dy2: 50px; --dx3: -60px; --dy3: -80px; animation-delay: -11s; }

          .float-particle.large {
            width: 12px;
            height: 12px;
            background: radial-gradient(circle, rgba(139, 92, 246, 0.6) 0%, transparent 70%);
            box-shadow: 0 0 20px rgba(139, 92, 246, 0.5);
          }

          .float-particle.small {
            width: 4px;
            height: 4px;
            background: radial-gradient(circle, rgba(6, 182, 212, 0.7) 0%, transparent 70%);
            box-shadow: 0 0 10px rgba(6, 182, 212, 0.4);
          }

          @keyframes letter-appear {
            0% {
              opacity: 0;
              transform: translateY(30px) scale(0.5);
              filter: blur(10px);
            }
            60% {
              transform: translateY(-5px) scale(1.05);
            }
            100% {
              opacity: 1;
              transform: translateY(0) scale(1);
              filter: blur(0);
            }
          }

          @keyframes letter-float {
            0%, 100% {
              transform: translateY(0);
            }
            50% {
              transform: translateY(-8px);
            }
          }

          .breathe-container {
            position: relative;
          }

          .breathe-text {
            position: relative;
            color: #fff;
            animation: breathe-glow 2.5s ease-in-out infinite;
          }

          .breathe-text .letter {
            display: inline-block;
            opacity: 0;
            animation:
              letter-appear 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
              letter-float 3s ease-in-out infinite;
          }

          .breathe-text .letter:nth-child(1) {
            animation-delay: 0s, 0.6s;
          }
          .breathe-text .letter:nth-child(2) {
            animation-delay: 0.08s, 0.68s;
          }
          .breathe-text .letter:nth-child(3) {
            animation-delay: 0.16s, 0.76s;
          }
          .breathe-text .letter:nth-child(4) {
            animation-delay: 0.24s, 0.84s;
          }
          .breathe-text .letter:nth-child(5) {
            animation-delay: 0.32s, 0.92s;
          }
          .breathe-text .letter:nth-child(6) {
            animation-delay: 0.4s, 1s;
          }

          @keyframes pulse-ring {
            0% {
              transform: scale(0.8);
              opacity: 0;
              border-width: 3px;
            }
            50% {
              opacity: 0.6;
            }
            100% {
              transform: scale(1.5);
              opacity: 0;
              border-width: 0px;
            }
          }

          .pulse-ring {
            position: absolute;
            inset: -30px;
            border: 2px solid rgba(59, 130, 246, 0.6);
            border-radius: 50%;
            animation: pulse-ring 2.5s ease-out infinite;
            pointer-events: none;
          }

          .pulse-ring:nth-child(2) {
            animation-delay: 0.8s;
            border-color: rgba(139, 92, 246, 0.5);
          }

          .pulse-ring:nth-child(3) {
            animation-delay: 1.6s;
            border-color: rgba(6, 182, 212, 0.5);
          }

          @keyframes orbit-dots {
            0% {
              transform: rotate(0deg);
            }
            100% {
              transform: rotate(360deg);
            }
          }

          .orbit-container {
            position: absolute;
            inset: -60px;
            animation: orbit-dots 8s linear infinite;
            pointer-events: none;
          }

          .orbit-dot {
            position: absolute;
            width: 6px;
            height: 6px;
            background: radial-gradient(circle, rgba(59, 130, 246, 1) 0%, rgba(59, 130, 246, 0.3) 100%);
            border-radius: 50%;
            box-shadow: 0 0 10px rgba(59, 130, 246, 0.8);
          }

          .orbit-dot:nth-child(1) { top: 0; left: 50%; transform: translateX(-50%); }
          .orbit-dot:nth-child(2) { top: 50%; right: 0; transform: translateY(-50%); }
          .orbit-dot:nth-child(3) { bottom: 0; left: 50%; transform: translateX(-50%); }
          .orbit-dot:nth-child(4) { top: 50%; left: 0; transform: translateY(-50%); }

          @keyframes particle-float {
            0% {
              transform: translate(0, 0) scale(0);
              opacity: 0;
            }
            10% {
              opacity: 1;
            }
            90% {
              opacity: 1;
            }
            100% {
              transform: translate(var(--tx), var(--ty)) scale(1);
              opacity: 0;
            }
          }

          .particles {
            position: absolute;
            inset: 0;
            pointer-events: none;
          }

          .particle {
            position: absolute;
            width: 4px;
            height: 4px;
            background: radial-gradient(circle, rgba(59, 130, 246, 1) 0%, transparent 70%);
            border-radius: 50%;
            animation: particle-float 3s ease-out infinite;
          }

          .particle:nth-child(1) { left: 50%; top: 50%; --tx: -80px; --ty: -80px; animation-delay: 0s; }
          .particle:nth-child(2) { left: 50%; top: 50%; --tx: 80px; --ty: -80px; animation-delay: 0.3s; }
          .particle:nth-child(3) { left: 50%; top: 50%; --tx: -80px; --ty: 80px; animation-delay: 0.6s; }
          .particle:nth-child(4) { left: 50%; top: 50%; --tx: 80px; --ty: 80px; animation-delay: 0.9s; }
          .particle:nth-child(5) { left: 50%; top: 50%; --tx: 0px; --ty: -100px; animation-delay: 0.15s; }
          .particle:nth-child(6) { left: 50%; top: 50%; --tx: 0px; --ty: 100px; animation-delay: 0.45s; }
          .particle:nth-child(7) { left: 50%; top: 50%; --tx: -100px; --ty: 0px; animation-delay: 0.75s; }
          .particle:nth-child(8) { left: 50%; top: 50%; --tx: 100px; --ty: 0px; animation-delay: 1.05s; }

          /* Typewriter Animation Styles - Retro Terminal Theme */
          @keyframes type-letter {
            0% {
              opacity: 0;
              transform: translateY(10px);
            }
            100% {
              opacity: 1;
              transform: translateY(0);
            }
          }

          @keyframes cursor-blink {
            0%, 49% {
              opacity: 1;
              background-color: rgba(0, 255, 0, 1);
            }
            50%, 100% {
              opacity: 0;
              background-color: rgba(0, 255, 0, 0);
            }
          }

          @keyframes char-rain {
            0% {
              transform: translateY(-20px);
              opacity: 0;
            }
            10% {
              opacity: 0.7;
            }
            90% {
              opacity: 0.3;
            }
            100% {
              transform: translateY(100vh);
              opacity: 0;
            }
          }

          @keyframes crt-scan {
            0% {
              top: 0;
            }
            100% {
              top: 100%;
            }
          }

          @keyframes cursor-trail {
            0% {
              transform: translate(0, 0);
              opacity: 0.6;
            }
            100% {
              transform: translate(var(--trail-x), var(--trail-y));
              opacity: 0;
            }
          }

          .typewriter-fullscreen {
            position: absolute;
            inset: 0;
            overflow: hidden;
            background:
              linear-gradient(rgba(0, 0, 0, 0) 50%, rgba(0, 20, 0, 0.05) 50%),
              linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.03));
            background-size: 100% 4px, 3px 100%;
          }

          .terminal-chars-rain {
            position: absolute;
            inset: 0;
            pointer-events: none;
            font-family: 'Courier New', monospace;
            font-size: 16px;
            color: rgba(0, 255, 0, 0.4);
          }

          .char-column {
            position: absolute;
            top: -50px;
            animation: char-rain linear infinite;
            text-shadow: 0 0 8px rgba(0, 255, 0, 0.6);
            white-space: pre;
          }

          .char-column:nth-child(1) { left: 8%; animation-duration: 6s; animation-delay: 0s; }
          .char-column:nth-child(2) { left: 18%; animation-duration: 8s; animation-delay: -1s; }
          .char-column:nth-child(3) { left: 28%; animation-duration: 7s; animation-delay: -2s; }
          .char-column:nth-child(4) { left: 38%; animation-duration: 9s; animation-delay: -0.5s; }
          .char-column:nth-child(5) { left: 48%; animation-duration: 6.5s; animation-delay: -1.5s; }
          .char-column:nth-child(6) { left: 58%; animation-duration: 8.5s; animation-delay: -3s; }
          .char-column:nth-child(7) { left: 68%; animation-duration: 7.5s; animation-delay: -2.5s; }
          .char-column:nth-child(8) { left: 78%; animation-duration: 9.5s; animation-delay: -1.8s; }
          .char-column:nth-child(9) { left: 88%; animation-duration: 6.8s; animation-delay: -0.8s; }

          .crt-scanline {
            position: absolute;
            width: 100%;
            height: 100px;
            left: 0;
            top: 0;
            background: linear-gradient(
              to bottom,
              transparent 0%,
              rgba(0, 255, 0, 0.03) 50%,
              transparent 100%
            );
            animation: crt-scan 6s linear infinite;
            pointer-events: none;
          }

          .cursor-trails {
            position: absolute;
            inset: 0;
            pointer-events: none;
          }

          .cursor-trail {
            position: absolute;
            width: 3px;
            height: 20px;
            background: rgba(0, 255, 0, 0.6);
            box-shadow: 0 0 10px rgba(0, 255, 0, 0.8);
            animation: cursor-trail 3s ease-out infinite;
          }

          .cursor-trail:nth-child(1) { left: 20%; top: 30%; --trail-x: 200px; --trail-y: -150px; animation-delay: 0s; }
          .cursor-trail:nth-child(2) { left: 60%; top: 70%; --trail-x: -180px; --trail-y: 120px; animation-delay: 1s; }
          .cursor-trail:nth-child(3) { left: 80%; top: 20%; --trail-x: -220px; --trail-y: 180px; animation-delay: 2s; }
          .cursor-trail:nth-child(4) { left: 40%; top: 80%; --trail-x: 150px; --trail-y: -200px; animation-delay: 0.5s; }
          .cursor-trail:nth-child(5) { left: 70%; top: 50%; --trail-x: -160px; --trail-y: -140px; animation-delay: 1.5s; }

          .typewriter-container {
            position: relative;
            z-index: 10;
          }

          .typewriter-text {
            color: #0f0;
            display: inline-flex;
            text-shadow: 0 0 10px rgba(0, 255, 0, 0.6);
            filter: drop-shadow(0 0 5px rgba(0, 255, 0, 0.4));
          }

          .typewriter-text .type-letter {
            display: inline-block;
            opacity: 0;
            animation: type-letter 0.1s forwards;
          }

          .typewriter-text .type-letter:nth-child(1) { animation-delay: 0s; }
          .typewriter-text .type-letter:nth-child(2) { animation-delay: 0.15s; }
          .typewriter-text .type-letter:nth-child(3) { animation-delay: 0.3s; }
          .typewriter-text .type-letter:nth-child(4) { animation-delay: 0.45s; }
          .typewriter-text .type-letter:nth-child(5) { animation-delay: 0.6s; }
          .typewriter-text .type-letter:nth-child(6) { animation-delay: 0.75s; }

          .typing-cursor {
            display: inline-block;
            width: 3px;
            height: 1em;
            margin-left: 4px;
            background-color: rgba(0, 255, 0, 1);
            animation: cursor-blink 1s infinite;
            animation-delay: 0.9s;
            box-shadow: 0 0 8px rgba(0, 255, 0, 0.8);
          }

          /* Scanner Animation Styles - Matrix/Hacker Theme */
          @keyframes vertical-scan {
            0% {
              top: -20%;
            }
            100% {
              top: 120%;
            }
          }

          @keyframes code-fall {
            0% {
              transform: translateY(-100%);
              opacity: 0;
            }
            10% {
              opacity: 1;
            }
            90% {
              opacity: 1;
            }
            100% {
              transform: translateY(100vh);
              opacity: 0;
            }
          }

          @keyframes scanner-glow {
            0%, 100% {
              text-shadow:
                0 0 20px rgba(0, 255, 0, 0.6),
                0 0 40px rgba(0, 255, 0, 0.4),
                0 0 60px rgba(0, 255, 0, 0.2);
              color: #0f0;
            }
            50% {
              text-shadow:
                0 0 40px rgba(0, 255, 0, 1),
                0 0 80px rgba(0, 255, 0, 0.8),
                0 0 120px rgba(0, 255, 0, 0.6),
                0 0 160px rgba(0, 255, 0, 0.4);
              color: #0ff;
            }
          }

          @keyframes code-flicker {
            0%, 100% {
              opacity: 0.05;
            }
            50% {
              opacity: 0.15;
            }
          }

          .scanner-fullscreen {
            position: absolute;
            inset: 0;
            overflow: hidden;
            background: radial-gradient(ellipse at center, rgba(0, 20, 0, 0.3) 0%, rgba(0, 0, 0, 0.95) 100%);
          }

          .scanner-container {
            position: relative;
            overflow: visible;
            z-index: 10;
          }

          .scanner-text {
            color: #0f0;
            animation: scanner-glow 2s ease-in-out infinite;
            position: relative;
            z-index: 10;
            filter: drop-shadow(0 0 10px rgba(0, 255, 0, 0.8));
          }

          /* Matrix digital rain */
          .matrix-rain {
            position: absolute;
            inset: 0;
            overflow: hidden;
            pointer-events: none;
          }

          .matrix-column {
            position: absolute;
            top: 0;
            width: 20px;
            height: 100%;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            color: #0f0;
            opacity: 0.6;
            animation: code-fall linear infinite;
            text-shadow: 0 0 5px rgba(0, 255, 0, 0.8);
            white-space: pre;
            line-height: 20px;
          }

          /* Stagger the columns */
          .matrix-column:nth-child(1) { left: 5%; animation-duration: 8s; animation-delay: 0s; }
          .matrix-column:nth-child(2) { left: 15%; animation-duration: 10s; animation-delay: -2s; }
          .matrix-column:nth-child(3) { left: 25%; animation-duration: 7s; animation-delay: -4s; }
          .matrix-column:nth-child(4) { left: 35%; animation-duration: 9s; animation-delay: -1s; }
          .matrix-column:nth-child(5) { left: 45%; animation-duration: 11s; animation-delay: -3s; }
          .matrix-column:nth-child(6) { left: 55%; animation-duration: 8s; animation-delay: -5s; }
          .matrix-column:nth-child(7) { left: 65%; animation-duration: 10s; animation-delay: -2.5s; }
          .matrix-column:nth-child(8) { left: 75%; animation-duration: 9s; animation-delay: -4.5s; }
          .matrix-column:nth-child(9) { left: 85%; animation-duration: 7s; animation-delay: -1.5s; }
          .matrix-column:nth-child(10) { left: 95%; animation-duration: 10s; animation-delay: -3.5s; }

          /* Powerful scan beam */
          .vertical-scan-line {
            position: absolute;
            width: 100%;
            height: 150px;
            left: 0;
            background: linear-gradient(
              to bottom,
              transparent 0%,
              rgba(0, 255, 0, 0.05) 20%,
              rgba(0, 255, 255, 0.4) 45%,
              rgba(0, 255, 255, 1) 50%,
              rgba(0, 255, 255, 0.4) 55%,
              rgba(0, 255, 0, 0.05) 80%,
              transparent 100%
            );
            animation: vertical-scan 4s linear infinite;
            z-index: 5;
            pointer-events: none;
            box-shadow:
              0 0 50px rgba(0, 255, 255, 0.8),
              0 0 100px rgba(0, 255, 255, 0.4);
            filter: blur(1px);
          }

          .vertical-scan-line::before {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(
              to bottom,
              transparent 48%,
              rgba(255, 255, 255, 0.8) 50%,
              transparent 52%
            );
          }

          /* Dense grid */
          .scanner-grid {
            position: absolute;
            inset: 0;
            background-image:
              linear-gradient(rgba(0, 255, 0, 0.15) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0, 255, 0, 0.15) 1px, transparent 1px);
            background-size: 15px 15px;
            opacity: 0.4;
            pointer-events: none;
            animation: code-flicker 3s ease-in-out infinite;
          }

          /* Random code snippets */
          .code-fragments {
            position: absolute;
            inset: 0;
            pointer-events: none;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            color: rgba(0, 255, 0, 0.3);
          }

          .code-fragment {
            position: absolute;
            animation: code-flicker 2s ease-in-out infinite;
            text-shadow: 0 0 5px rgba(0, 255, 0, 0.5);
          }

          .code-fragment:nth-child(1) { top: 10%; left: 10%; animation-delay: 0s; }
          .code-fragment:nth-child(2) { top: 20%; right: 15%; animation-delay: 0.5s; }
          .code-fragment:nth-child(3) { top: 40%; left: 20%; animation-delay: 1s; }
          .code-fragment:nth-child(4) { bottom: 30%; right: 25%; animation-delay: 1.5s; }
          .code-fragment:nth-child(5) { bottom: 15%; left: 30%; animation-delay: 0.8s; }

          /* Pulse Ripple Animation Styles - Sonar/Radar Theme */
          @keyframes wave-expand {
            0% {
              width: 80px;
              height: 80px;
              opacity: 1;
              border-width: 4px;
            }
            100% {
              width: 500px;
              height: 500px;
              opacity: 0;
              border-width: 1px;
            }
          }

          @keyframes pulse-text-glow {
            0%, 100% {
              text-shadow:
                0 0 20px rgba(59, 130, 246, 0.8),
                0 0 40px rgba(59, 130, 246, 0.5),
                0 0 60px rgba(59, 130, 246, 0.3);
              transform: scale(1);
            }
            50% {
              text-shadow:
                0 0 40px rgba(59, 130, 246, 1),
                0 0 80px rgba(59, 130, 246, 0.8),
                0 0 120px rgba(59, 130, 246, 0.6),
                0 0 160px rgba(59, 130, 246, 0.4);
              transform: scale(1.02);
            }
          }

          @keyframes radar-sweep {
            0% {
              transform: rotate(0deg);
            }
            100% {
              transform: rotate(360deg);
            }
          }

          @keyframes target-blink {
            0%, 100% {
              opacity: 0.3;
              transform: scale(1);
            }
            50% {
              opacity: 1;
              transform: scale(1.2);
            }
          }

          @keyframes sonar-pulse {
            0% {
              transform: scale(0.5);
              opacity: 0;
            }
            50% {
              opacity: 0.8;
            }
            100% {
              transform: scale(2);
              opacity: 0;
            }
          }

          .pulse-fullscreen {
            position: absolute;
            inset: 0;
            overflow: hidden;
            background: radial-gradient(circle at center, rgba(0, 30, 60, 0.3) 0%, rgba(0, 0, 0, 0.95) 100%);
          }

          .radar-grid {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
          }

          .radar-circle {
            position: absolute;
            border: 1px solid rgba(59, 130, 246, 0.2);
            border-radius: 50%;
            opacity: 0.4;
          }

          .radar-circle:nth-child(1) { width: 200px; height: 200px; }
          .radar-circle:nth-child(2) { width: 350px; height: 350px; }
          .radar-circle:nth-child(3) { width: 500px; height: 500px; }
          .radar-circle:nth-child(4) { width: 650px; height: 650px; }
          .radar-circle:nth-child(5) { width: 800px; height: 800px; }

          .radar-lines {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
          }

          .radar-line {
            position: absolute;
            width: 1px;
            height: 100%;
            background: linear-gradient(to bottom, transparent 45%, rgba(59, 130, 246, 0.15) 50%, transparent 55%);
          }

          .radar-line:nth-child(1) { transform: rotate(0deg); }
          .radar-line:nth-child(2) { transform: rotate(45deg); }
          .radar-line:nth-child(3) { transform: rotate(90deg); }
          .radar-line:nth-child(4) { transform: rotate(135deg); }

          .sonar-waves {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
          }

          .sonar-wave {
            position: absolute;
            border: 2px solid rgba(59, 130, 246, 0.6);
            border-radius: 50%;
            width: 100px;
            height: 100px;
            animation: sonar-pulse 3s ease-out infinite;
          }

          .sonar-wave:nth-child(1) { animation-delay: 0s; }
          .sonar-wave:nth-child(2) { animation-delay: 0.6s; }
          .sonar-wave:nth-child(3) { animation-delay: 1.2s; }
          .sonar-wave:nth-child(4) { animation-delay: 1.8s; }
          .sonar-wave:nth-child(5) { animation-delay: 2.4s; }

          .radar-targets {
            position: absolute;
            inset: 0;
            pointer-events: none;
          }

          .radar-target {
            position: absolute;
            width: 8px;
            height: 8px;
            background: rgba(0, 255, 255, 0.8);
            border-radius: 50%;
            box-shadow: 0 0 15px rgba(0, 255, 255, 0.8);
            animation: target-blink 2s ease-in-out infinite;
          }

          .radar-target:nth-child(1) { left: 20%; top: 25%; animation-delay: 0s; }
          .radar-target:nth-child(2) { left: 75%; top: 35%; animation-delay: 0.5s; }
          .radar-target:nth-child(3) { left: 45%; top: 70%; animation-delay: 1s; }
          .radar-target:nth-child(4) { left: 65%; top: 60%; animation-delay: 1.5s; }
          .radar-target:nth-child(5) { left: 30%; top: 80%; animation-delay: 0.3s; }
          .radar-target:nth-child(6) { left: 85%; top: 75%; animation-delay: 0.8s; }
          .radar-target:nth-child(7) { left: 15%; top: 55%; animation-delay: 1.3s; }
          .radar-target:nth-child(8) { left: 55%; top: 20%; animation-delay: 0.6s; }

          .pulse-container {
            position: relative;
          }

          .pulse-text {
            color: #fff;
            animation: pulse-text-glow 2s ease-in-out infinite;
            position: relative;
            z-index: 10;
          }

          .wave-ring {
            position: absolute;
            top: 50%;
            left: 50%;
            border: 3px solid rgba(59, 130, 246, 0.8);
            border-radius: 50%;
            transform: translate(-50%, -50%);
            animation: wave-expand 2.5s ease-out infinite;
            pointer-events: none;
          }

          .wave-ring:nth-child(2) {
            animation-delay: 0.5s;
            border-color: rgba(139, 92, 246, 0.7);
          }

          .wave-ring:nth-child(3) {
            animation-delay: 1s;
            border-color: rgba(6, 182, 212, 0.7);
          }

          .wave-ring:nth-child(4) {
            animation-delay: 1.5s;
            border-color: rgba(59, 130, 246, 0.6);
          }

          .wave-ring:nth-child(5) {
            animation-delay: 2s;
            border-color: rgba(139, 92, 246, 0.5);
          }

          .radar-sweep {
            position: absolute;
            inset: -100px;
            pointer-events: none;
            animation: radar-sweep 4s linear infinite;
          }

          .radar-sweep::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 2px;
            height: 50%;
            background: linear-gradient(
              to bottom,
              rgba(59, 130, 246, 0) 0%,
              rgba(59, 130, 246, 0.8) 100%
            );
            transform-origin: top center;
            transform: translateX(-50%) translateY(-100%);
          }

          .pulse-center-dot {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 12px;
            height: 12px;
            background: radial-gradient(circle, rgba(59, 130, 246, 1) 0%, rgba(59, 130, 246, 0.3) 100%);
            border-radius: 50%;
            transform: translate(-50%, -50%);
            box-shadow:
              0 0 20px rgba(59, 130, 246, 1),
              0 0 40px rgba(59, 130, 246, 0.8);
            z-index: 5;
          }
        `}
      </style>

      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center z-50 transition-opacity duration-300",
          isFadingOut ? "opacity-0" : "opacity-100",
          className,
        )}
        style={{ backgroundColor: backgroundColor || "rgba(0, 0, 0, 0.92)" }}
      >
        {animationType === "glitch" ? (
          <>
            {/* Fullscreen Glitch Background */}
            <div className="glitch-fullscreen">
              {/* RGB Split Layers */}
              <div className="rgb-split-layers">
                <div className="rgb-layer red"></div>
                <div className="rgb-layer green"></div>
                <div className="rgb-layer blue"></div>
              </div>

              {/* Signal Distortion Bars */}
              <div className="signal-bars">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="signal-bar"></div>
                ))}
              </div>

              {/* Original Effects */}
              <div className="noise-overlay"></div>
              <div className="glitch-blocks"></div>
            </div>

            <div className="flex flex-col items-center gap-8">
              <div className="glitch-container relative">
                {/* TERMIX Glitch Text */}
                <div
                  className="glitch-text text-6xl font-bold tracking-wider select-none"
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    textShadow:
                      "0 0 30px rgba(255, 255, 255, 0.3), 0 0 60px rgba(0, 255, 255, 0.2)",
                  }}
                >
                  TERMIX
                </div>

                {/* Scan line effect */}
                <div className="scan-line"></div>
              </div>

              {message && (
                <div className="text-center relative z-10">
                  <p className="text-sm text-gray-300 font-medium tracking-wide animate-pulse">
                    {message}
                  </p>
                </div>
              )}
            </div>
          </>
        ) : animationType === "breathe" ? (
          <>
            {/* Fullscreen Elegant Background */}
            <div className="breathe-fullscreen">
              {/* Floating Particles Field */}
              <div className="breathe-particles-field">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "float-particle",
                      i % 3 === 0 ? "large" : i % 3 === 1 ? "small" : "",
                    )}
                  ></div>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-center gap-8">
              <div className="breathe-container relative">
                {/* Pulse rings */}
                <div className="pulse-ring"></div>
                <div className="pulse-ring"></div>
                <div className="pulse-ring"></div>

                {/* Orbiting dots */}
                <div className="orbit-container">
                  <div className="orbit-dot"></div>
                  <div className="orbit-dot"></div>
                  <div className="orbit-dot"></div>
                  <div className="orbit-dot"></div>
                </div>

                {/* Particles */}
                <div className="particles">
                  <div className="particle"></div>
                  <div className="particle"></div>
                  <div className="particle"></div>
                  <div className="particle"></div>
                  <div className="particle"></div>
                  <div className="particle"></div>
                  <div className="particle"></div>
                  <div className="particle"></div>
                </div>

                {/* TERMIX Breathe Text */}
                <div
                  className="breathe-text text-6xl font-bold tracking-wider select-none"
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  }}
                >
                  <span className="letter">T</span>
                  <span className="letter">E</span>
                  <span className="letter">R</span>
                  <span className="letter">M</span>
                  <span className="letter">I</span>
                  <span className="letter">X</span>
                </div>
              </div>

              {message && (
                <div className="text-center relative z-10">
                  <p className="text-sm text-gray-300 font-medium tracking-wide animate-pulse">
                    {message}
                  </p>
                </div>
              )}
            </div>
          </>
        ) : animationType === "typewriter" ? (
          <>
            {/* Fullscreen Retro Terminal Background */}
            <div className="typewriter-fullscreen">
              {/* ASCII Character Rain */}
              <div className="terminal-chars-rain">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="char-column">
                    {`$\n>\n_\n{\n}\n[\n]\n|\n/\n\\\n-\n+\n*\n#\n@\n%`}
                  </div>
                ))}
              </div>

              {/* CRT Scanline */}
              <div className="crt-scanline"></div>

              {/* Cursor Trails */}
              <div className="cursor-trails">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="cursor-trail"></div>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-center gap-8">
              <div className="typewriter-container relative">
                {/* TERMIX Typewriter Text */}
                <div
                  className="typewriter-text text-6xl font-bold tracking-wider select-none"
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  }}
                >
                  <span className="type-letter">T</span>
                  <span className="type-letter">E</span>
                  <span className="type-letter">R</span>
                  <span className="type-letter">M</span>
                  <span className="type-letter">I</span>
                  <span className="type-letter">X</span>
                  <span className="typing-cursor"></span>
                </div>
              </div>

              {message && (
                <div className="text-center relative z-10">
                  <p
                    className="text-sm text-green-400 font-medium tracking-wide"
                    style={{ textShadow: "0 0 10px rgba(0, 255, 0, 0.6)" }}
                  >
                    {message}
                  </p>
                </div>
              )}
            </div>
          </>
        ) : animationType === "scanner" ? (
          <>
            {/* Fullscreen Matrix Background */}
            <div className="scanner-fullscreen">
              {/* Grid Background */}
              <div className="scanner-grid"></div>

              {/* Matrix Digital Rain */}
              <div className="matrix-rain">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="matrix-column">
                    {`01\n10\n11\n00\n01\n10\n11\n00\n01\n10\n11\n00\n01\n10\n11\n00\n01\n10\n11\n00`}
                  </div>
                ))}
              </div>

              {/* Random Code Fragments */}
              <div className="code-fragments">
                <div className="code-fragment">
                  {"{"} ssh: 22 {"}"}
                </div>
                <div className="code-fragment">
                  {"<"} connect... {">"}
                </div>
                <div className="code-fragment">0x4A3F2B1D</div>
                <div className="code-fragment">[SCANNING...]</div>
                <div className="code-fragment">{">"} _</div>
              </div>

              {/* Powerful Scan Beam */}
              <div className="vertical-scan-line"></div>
            </div>

            <div className="flex flex-col items-center gap-8">
              <div className="scanner-container relative">
                {/* TERMIX Scanner Text */}
                <div
                  className="scanner-text text-6xl font-bold tracking-wider select-none"
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  }}
                >
                  TERMIX
                </div>
              </div>

              {message && (
                <div className="text-center relative z-10">
                  <p
                    className="text-sm text-green-400 font-medium tracking-wide"
                    style={{ textShadow: "0 0 10px rgba(0, 255, 0, 0.6)" }}
                  >
                    {message}
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Fullscreen Radar/Sonar Background */}
            <div className="pulse-fullscreen">
              {/* Radar Circular Grid */}
              <div className="radar-grid">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="radar-circle"></div>
                ))}
              </div>

              {/* Radar Cross Lines */}
              <div className="radar-lines">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="radar-line"></div>
                ))}
              </div>

              {/* Sonar Pulse Waves */}
              <div className="sonar-waves">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="sonar-wave"></div>
                ))}
              </div>

              {/* Radar Targets (Detection Points) */}
              <div className="radar-targets">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="radar-target"></div>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-center gap-8">
              <div className="pulse-container relative">
                {/* Wave Rings */}
                <div className="wave-ring"></div>
                <div className="wave-ring"></div>
                <div className="wave-ring"></div>
                <div className="wave-ring"></div>
                <div className="wave-ring"></div>

                {/* Radar Sweep */}
                <div className="radar-sweep"></div>

                {/* Center Dot */}
                <div className="pulse-center-dot"></div>

                {/* TERMIX Pulse Text */}
                <div
                  className="pulse-text text-6xl font-bold tracking-wider select-none"
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  }}
                >
                  TERMIX
                </div>
              </div>

              {message && (
                <div className="text-center relative z-10">
                  <p className="text-sm text-gray-300 font-medium tracking-wide animate-pulse">
                    {message}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
