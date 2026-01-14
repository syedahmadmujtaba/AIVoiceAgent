import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { decode, decodeAudioData, createBlob } from './utils/audio';

enum AgentStatus {
  Idle = "Start",
  Listening = "Listening",
  Thinking = "Processing",
  Speaking = "Speaking",
  Error = "Error",
}

// --- Visualizer Component ---
// A circular, organic visualizer that reacts to frequency data
const SonicOrb = ({ analyserNode, status }: { analyserNode: AnalyserNode | null, status: AgentStatus }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameIdRef = useRef<number | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Handle high DPI displays
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        let time = 0;
        const baseRadius = rect.width / 4; 
        const bufferLength = analyserNode ? analyserNode.frequencyBinCount : 0;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            animationFrameIdRef.current = requestAnimationFrame(draw);
            
            // Clear canvas
            ctx.clearRect(0, 0, rect.width, rect.height);

            // Get audio data if available
            if (analyserNode && (status === AgentStatus.Speaking || status === AgentStatus.Listening)) {
                analyserNode.getByteFrequencyData(dataArray);
            }

            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            ctx.beginPath();
            
            // Create organic circle shape
            for (let i = 0; i <= 100; i++) {
                const angle = (i / 100) * Math.PI * 2;
                
                // Base pulsing effect
                let offset = 0;

                if (status === AgentStatus.Listening) {
                    // Slow breath
                    offset = Math.sin(time * 0.05) * 5; 
                } else if (status === AgentStatus.Speaking) {
                    // Reactive to audio
                    // Map angle to frequency index roughly
                    const dataIndex = Math.floor((i / 100) * (bufferLength / 2));
                    const value = dataArray[dataIndex] || 0;
                    offset = (value / 255) * 60;
                } else if (status === AgentStatus.Thinking) {
                     // Fast nervous pulse
                     offset = Math.sin(time * 0.2) * 10;
                }

                // Add some Perlin-like noise (simulated with sin waves)
                const noise = Math.sin(angle * 5 + time * 0.1) * 5 + Math.cos(angle * 3 - time * 0.1) * 5;
                
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

            // Gradient Fill
            const gradient = ctx.createRadialGradient(centerX, centerY, baseRadius * 0.2, centerX, centerY, baseRadius * 2);
            if (status === AgentStatus.Error) {
                gradient.addColorStop(0, 'rgba(239, 68, 68, 0.8)');
                gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
            } else if (status === AgentStatus.Speaking) {
                gradient.addColorStop(0, 'rgba(124, 58, 237, 0.8)'); // Violet
                gradient.addColorStop(0.5, 'rgba(245, 158, 11, 0.3)'); // Amber hint
                gradient.addColorStop(1, 'rgba(124, 58, 237, 0)');
            } else {
                gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
                gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            }

            ctx.fillStyle = gradient;
            ctx.fill();

            // Stroke
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();

            time += 1;
        };

        draw();

        return () => {
            if (animationFrameIdRef.current) {
                cancelAnimationFrame(animationFrameIdRef.current);
            }
        };
    }, [analyserNode, status]);

    return <canvas ref={canvasRef} className="w-full h-full" />;
};

export default function App() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>(AgentStatus.Idle);

  // sessionRef typed as any because LiveSession is not exported from @google/genai
  const sessionRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const nextStartTimeRef = useRef(0);

  // System instruction tailored for bilingual switching
  const systemInstruction = `You are a sophisticated bilingual voice AI. 
  Your core function is to fluently switch between Urdu and English based on the user's language.
  - If I speak English, reply in concise, witty English.
  - If I speak Urdu, reply in natural, conversational Urdu.
  - If I mix languages (Roman Urdu/English), reply in Urdu.
  - Keep responses short, human-like, and engaging. Avoid robotic pleasantries.`;

  const stopConversation = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
    }
    if (mediaStreamSourceRef.current) {
        mediaStreamSourceRef.current.disconnect();
        mediaStreamSourceRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
        outputAudioContextRef.current.close();
    }

    setIsSessionActive(false);
    setAgentStatus(AgentStatus.Idle);
    nextStartTimeRef.current = 0;
  }, []);

  useEffect(() => {
    return () => {
      stopConversation();
    };
  }, [stopConversation]);
  
  const startConversation = async () => {
    try {
      setAgentStatus(AgentStatus.Listening);
      setIsSessionActive(true);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      // Using a single AudioContext for input and output logic if possible, but keeping separate for simplicity as per existing
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      nextStartTimeRef.current = 0;
      
      const analyser = outputAudioContextRef.current.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5; // Smoother animations
      analyser.connect(outputAudioContextRef.current.destination);
      analyserNodeRef.current = analyser;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: systemInstruction,
        },
        callbacks: {
          onopen: () => {
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            mediaStreamSourceRef.current = source;
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
                // Assuming user is speaking if input transcription is received
                setAgentStatus(AgentStatus.Listening);
            }

            if(message.serverContent?.turnComplete) {
                setAgentStatus(AgentStatus.Listening);
            }

            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current && analyserNodeRef.current) {
                setAgentStatus(AgentStatus.Speaking);
                const decodedAudio = decode(audioData);
                const audioBuffer = await decodeAudioData(decodedAudio, outputAudioContextRef.current, 24000, 1);
                
                const currentTime = outputAudioContextRef.current.currentTime;
                const startTime = Math.max(currentTime, nextStartTimeRef.current);

                const source = outputAudioContextRef.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(analyserNodeRef.current);
                source.start(startTime);

                nextStartTimeRef.current = startTime + audioBuffer.duration;
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error('Session error:', e);
            setAgentStatus(AgentStatus.Error);
            stopConversation();
          },
          onclose: (e: CloseEvent) => {
            stopConversation();
          },
        },
      });

      sessionRef.current = await sessionPromise;

    } catch (error) {
      console.error("Failed to start conversation:", error);
      setAgentStatus(AgentStatus.Error);
      setIsSessionActive(false);
    }
  };

  const handleToggleSession = () => {
    if (isSessionActive) {
      stopConversation();
    } else {
      startConversation();
    }
  };

  return (
    <div className="relative w-full h-screen flex flex-col items-center justify-between p-6 overflow-hidden bg-[#030305] text-gray-100">
      
      {/* Background Ambience */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-violet-900/20 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-amber-900/20 rounded-full blur-[100px] pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 w-full flex justify-between items-center opacity-80">
        <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-gray-500">Bilingual Interface v2.0</span>
        </div>
        <div className="glass-panel px-3 py-1 rounded-full flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isSessionActive ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
            <span className="text-xs font-mono uppercase text-gray-400">{isSessionActive ? 'Online' : 'Offline'}</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-grow flex flex-col items-center justify-center w-full max-w-2xl">
        
        {/* The Sonic Orb Visualizer */}
        <div className="relative w-[300px] h-[300px] md:w-[450px] md:h-[450px]">
            <SonicOrb analyserNode={analyserNodeRef.current} status={agentStatus} />
            
            {/* Background Typography Depth Layer */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full text-center pointer-events-none mix-blend-overlay opacity-30">
                <h1 className="font-display text-[8rem] leading-none font-bold tracking-tighter select-none blur-sm">
                    {agentStatus === AgentStatus.Speaking ? 'SUNIYE' : 'BOLIYE'}
                </h1>
            </div>
        </div>

        {/* Text Prompt / Subtitles */}
        <div className="mt-8 text-center h-12">
             <p className={`text-lg font-light tracking-wide transition-opacity duration-500 ${agentStatus !== AgentStatus.Idle ? 'opacity-100' : 'opacity-0'}`}>
                {agentStatus === AgentStatus.Listening && "Listening..."}
                {agentStatus === AgentStatus.Thinking && "Translating context..."}
                {agentStatus === AgentStatus.Speaking && "Responding..."}
                {agentStatus === AgentStatus.Error && <span className="text-red-400">Connection Error</span>}
            </p>
             {agentStatus === AgentStatus.Idle && (
                 <p className="text-gray-500 font-light animate-pulse">Ready to converse in Urdu & English</p>
             )}
        </div>

      </main>

      {/* Footer Controls */}
      <footer className="relative z-10 w-full flex justify-center pb-8">
        <button
            onClick={handleToggleSession}
            className={`group relative flex items-center justify-center px-8 py-4 rounded-full glass-panel transition-all duration-500 hover:bg-white/5 active:scale-95 ${isSessionActive ? 'border-red-500/30' : 'border-white/10'}`}
        >
            <span className={`absolute inset-0 rounded-full blur-md bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
            
            <div className="flex items-center gap-3 relative z-10">
                {isSessionActive ? (
                    <>
                        <span className="w-2 h-2 bg-red-500 rounded-sm animate-spin" />
                        <span className="font-mono text-sm uppercase tracking-widest text-red-200">Terminate</span>
                    </>
                ) : (
                    <>
                        <span className="w-2 h-2 bg-white rounded-full group-hover:bg-violet-400 transition-colors" />
                        <span className="font-mono text-sm uppercase tracking-widest">Initialize</span>
                    </>
                )}
            </div>
        </button>
      </footer>

    </div>
  );
}