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
  const [animationType, setAnimationType] = useState<'glitch' | 'breathe'>('glitch');
  const showStartTimeRef = useRef<number | null>(null);
  const minDurationTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (visible) {
      // Randomly choose animation type
      setAnimationType(Math.random() > 0.5 ? 'glitch' : 'breathe');

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

          /* Breathe Animation Styles */
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
        `}
      </style>

      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center z-50 transition-opacity duration-300",
          isFadingOut ? "opacity-0" : "opacity-100",
          className
        )}
        style={{ backgroundColor: backgroundColor || "rgba(0, 0, 0, 0.92)" }}
      >
        {animationType === 'glitch' ? (
          <>
            <div className="noise-overlay"></div>
            <div className="glitch-blocks"></div>

            <div className="flex flex-col items-center gap-8">
              <div className="glitch-container relative">
                {/* TERMIX Glitch Text */}
                <div
                  className="glitch-text text-6xl font-bold tracking-wider select-none"
                  style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    textShadow: '0 0 30px rgba(255, 255, 255, 0.3), 0 0 60px rgba(0, 255, 255, 0.2)'
                  }}
                >
                  TERMIX
                </div>

                {/* Scan line effect */}
                <div className="scan-line"></div>
              </div>

              {message && (
                <div className="text-center">
                  <p className="text-sm text-gray-300 font-medium tracking-wide animate-pulse">
                    {message}
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
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
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
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
                <div className="text-center">
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
