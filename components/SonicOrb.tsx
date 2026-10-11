import { useEffect, useRef } from 'react';
import { AgentStatus } from './status';

// --- Visualizer Component ---
export const SonicOrb = ({ analyserNode, status }: { analyserNode: AnalyserNode | null, status: AgentStatus }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameIdRef = useRef<number | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Function to handle resizing dynamically
        const setCanvasSize = () => {
            const dpr = window.devicePixelRatio || 1;
            // We use the parent container's dimensions
            const parent = canvas.parentElement;
            if (parent) {
                const rect = parent.getBoundingClientRect();
                canvas.width = rect.width * dpr;
                canvas.height = rect.height * dpr;
                ctx.scale(dpr, dpr);
            }
        };

        // Initial Set
        setCanvasSize();
        window.addEventListener('resize', setCanvasSize);

        let time = 0;
        
        const draw = () => {
            animationFrameIdRef.current = requestAnimationFrame(draw);
            
            // Re-fetch dimensions inside loop or rely on resize listener (listener is more efficient, 
            // but we need current width for drawing calculations)
            const width = canvas.width / (window.devicePixelRatio || 1);
            const height = canvas.height / (window.devicePixelRatio || 1);
            
            ctx.clearRect(0, 0, width, height);

            const bufferLength = analyserNode ? analyserNode.frequencyBinCount : 0;
            const dataArray = new Uint8Array(bufferLength);

            if (analyserNode && (status === AgentStatus.Speaking || status === AgentStatus.Listening)) {
                analyserNode.getByteFrequencyData(dataArray);
            }

            const centerX = width / 2;
            const centerY = height / 2;
            // Radius responsive to current canvas size
            const baseRadius = Math.min(width, height) / 4; 

            ctx.beginPath();
            
            for (let i = 0; i <= 100; i++) {
                const angle = (i / 100) * Math.PI * 2;
                
                let offset = 0;

                if (status === AgentStatus.Listening) {
                    offset = Math.sin(time * 0.05) * (baseRadius * 0.1); 
                } else if (status === AgentStatus.Speaking) {
                    const dataIndex = Math.floor((i / 100) * (bufferLength / 2));
                    const value = dataArray[dataIndex] || 0;
                    offset = (value / 255) * (baseRadius * 0.5);
                } else if (status === AgentStatus.Connecting) {
                     offset = Math.sin(time * 0.2) * (baseRadius * 0.15);
                }

                const noise = Math.sin(angle * 5 + time * 0.1) * (baseRadius * 0.05) + Math.cos(angle * 3 - time * 0.1) * (baseRadius * 0.05);
                
                const r = baseRadius + offset + noise;
                const x = centerX + Math.cos(angle) * r;
                const y = centerY + Math.sin(angle) * r;

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }

            ctx.closePath();

            const gradient = ctx.createRadialGradient(centerX, centerY, baseRadius * 0.2, centerX, centerY, baseRadius * 2);
            if (status === AgentStatus.Error) {
                gradient.addColorStop(0, 'rgba(239, 68, 68, 0.8)');
                gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
            } else if (status === AgentStatus.Speaking) {
                gradient.addColorStop(0, 'rgba(124, 58, 237, 0.8)');
                gradient.addColorStop(0.5, 'rgba(245, 158, 11, 0.3)');
                gradient.addColorStop(1, 'rgba(124, 58, 237, 0)');
            } else {
                gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
                gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            }

            ctx.fillStyle = gradient;
            ctx.fill();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();

            time += 1;
        };

        draw();

        return () => {
            window.removeEventListener('resize', setCanvasSize);
            if (animationFrameIdRef.current) {
                cancelAnimationFrame(animationFrameIdRef.current);
            }
        };
    }, [analyserNode, status]);

    return <canvas ref={canvasRef} className="w-full h-full block" />;
};

