import { useEffect, useState, useSyncExternalStore } from 'react';
import { VoiceSessionController } from '../voice/session';

export function useVoiceSession() {
  const [controller] = useState(() => new VoiceSessionController());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => () => { void controller.stop(); }, [controller]);
  return { ...state, start: controller.start, stop: controller.stop };
}
