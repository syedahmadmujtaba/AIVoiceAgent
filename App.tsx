import { SonicOrb } from './components/SonicOrb';
import { AgentStatus } from './components/status';
import { useVoiceSession } from './hooks/useVoiceSession';

export default function App() {
  const voice = useVoiceSession();
  const isSessionActive = !['idle', 'error'].includes(voice.connection);
  const agentStatus = voice.connection === 'error' ? AgentStatus.Error
    : ['connecting', 'reconnecting', 'stopping'].includes(voice.connection) ? AgentStatus.Connecting
    : voice.connection === 'idle' ? AgentStatus.Idle
    : voice.speaking ? AgentStatus.Speaking : AgentStatus.Listening;
  const handleToggleSession = () => { void (isSessionActive ? voice.stop() : voice.start()); };

  return (
    // 100dvh (Dynamic Viewport Height) ensures full height on mobile browsers including address bars
    <div className="relative w-full min-h-[100dvh] flex flex-col items-center justify-between p-4 md:p-8 overflow-hidden bg-[#030305] text-gray-100">
      
      {/* Background Ambience */}
      <div className="absolute top-[-20%] left-[-10%] w-[60vw] h-[60vw] bg-violet-900/20 rounded-full blur-[100px] md:blur-[128px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] bg-amber-900/20 rounded-full blur-[80px] md:blur-[100px] pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 w-full flex justify-between items-center opacity-80 shrink-0">
        <div className="flex flex-col">
            <span className="text-[10px] md:text-xs uppercase tracking-widest text-gray-500">Bilingual Interface v2.0</span>
        </div>
        <div className="glass-panel px-3 py-1 rounded-full flex items-center gap-2 border border-white/5 bg-white/5 backdrop-blur-sm">
            <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${voice.connection === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
            <span className="text-[10px] md:text-xs font-mono uppercase text-gray-400">{voice.connection === 'connected' ? 'Online' : voice.connection === 'reconnecting' ? 'Reconnecting' : voice.connection === 'connecting' ? 'Connecting' : 'Offline'}</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-grow flex flex-col items-center justify-center w-full">
        
        {/* The Sonic Orb Visualizer Container */}
        {/* 'vmin' sizes it relative to the smaller screen dimension (works for portrait & landscape) */}
        <div className="relative w-[70vmin] h-[70vmin] max-w-[500px] max-h-[500px] min-w-[250px] min-h-[250px] transition-all duration-300">
            <SonicOrb analyserNode={voice.analyser} status={agentStatus} />
            
            {/* Background Typography Depth Layer */}
            {/* Using fluid typography with clamp() */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full text-center pointer-events-none mix-blend-overlay opacity-30 flex items-center justify-center">
                <h1 
                    className="font-display font-bold tracking-tighter select-none blur-sm whitespace-nowrap transition-all duration-300"
                    style={{ fontSize: 'clamp(3rem, 18vmin, 8rem)' }}
                >
                    {agentStatus === AgentStatus.Speaking ? 'SUNIYE' : 'BOLIYE'}
                </h1>
            </div>
        </div>

        {/* Text Prompt / Subtitles */}
        <div className="mt-8 text-center min-h-12 max-w-lg shrink-0">
             <p aria-live="polite" className={`text-sm md:text-lg font-light tracking-wide transition-opacity duration-500 ${agentStatus !== AgentStatus.Idle ? 'opacity-100' : 'opacity-0'}`}>
                {agentStatus === AgentStatus.Listening && "Listening..."}
                {agentStatus === AgentStatus.Connecting && (voice.connection === 'reconnecting' ? 'Reconnecting...' : voice.connection === 'stopping' ? 'Stopping...' : 'Connecting...')}
                {agentStatus === AgentStatus.Speaking && "Responding..."}
                {agentStatus === AgentStatus.Error && <span role="alert" className="text-red-400">{voice.error}</span>}
            </p>
             {agentStatus === AgentStatus.Idle && (
                 <p className="text-xs md:text-base text-gray-500 font-light animate-pulse">Ready to converse in Urdu & English</p>
             )}
        </div>

        <details className="w-full max-w-lg mt-6 mb-6 text-sm text-gray-400">
          <summary className="cursor-pointer text-center">Conversation transcript</summary>
          <div className="mt-3 max-h-40 overflow-y-auto space-y-3 rounded-xl border border-white/10 p-4" role="log" aria-label="Conversation transcript">
            {voice.transcripts.length === 0 && <p>Transcripts appear here during your conversation.</p>}
            {voice.transcripts.map((entry, index) => (
              <p key={index} dir="auto"><span className="text-violet-300">{entry.role === 'user' ? 'You' : 'Agent'}: </span>{entry.text}</p>
            ))}
          </div>
        </details>
      </main>

      {/* Footer Controls */}
      <footer className="relative z-10 w-full flex justify-center pb-4 md:pb-8 shrink-0">
        <button
            onClick={handleToggleSession}
            disabled={voice.connection === 'stopping'}
            aria-label={isSessionActive ? 'Stop conversation' : 'Start conversation'}
            className={`group relative flex items-center justify-center px-6 py-3 md:px-8 md:py-4 rounded-full border bg-white/5 backdrop-blur-md transition-all duration-500 hover:bg-white/10 active:scale-95 ${isSessionActive ? 'border-red-500/30' : 'border-white/10'}`}
        >
            <span className={`absolute inset-0 rounded-full blur-md bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
            
            <div className="flex items-center gap-3 relative z-10">
                {isSessionActive ? (
                    <>
                        <span className="w-1.5 h-1.5 md:w-2 md:h-2 bg-red-500 rounded-sm animate-spin" />
                        <span className="font-mono text-xs md:text-sm uppercase tracking-widest text-red-200">{voice.connection === 'stopping' ? 'Stopping' : 'Stop'}</span>
                    </>
                ) : (
                    <>
                        <span className="w-1.5 h-1.5 md:w-2 md:h-2 bg-white rounded-full group-hover:bg-violet-400 transition-colors" />
                        <span className="font-mono text-xs md:text-sm uppercase tracking-widest">Start conversation</span>
                    </>
                )}
            </div>
        </button>
      </footer>

    </div>
  );
}
