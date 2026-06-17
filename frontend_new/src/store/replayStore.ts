import { create } from 'zustand';

export interface ReplayStatusData {
  position_s: number;
  duration_s: number;
  playing: boolean;
  speed: number;
  filename: string;
  density?: number[];
}

interface ReplayState extends ReplayStatusData {
  density: number[];
  isReplay: boolean;
  updateStatus: (data: ReplayStatusData) => void;
  reset: () => void;
}

export const useReplayStore = create<ReplayState>((set) => ({
  isReplay: false,
  position_s: 0,
  duration_s: 0,
  playing: true,
  speed: 1.0,
  filename: '',
  density: [],

  updateStatus: (data) =>
    set((s) => ({
      isReplay: true,
      position_s: data.position_s,
      duration_s: data.duration_s,
      playing: data.playing,
      speed: data.speed,
      filename: data.filename,
      density: data.density ?? s.density,
    })),

  reset: () =>
    set({ isReplay: false, position_s: 0, duration_s: 0, playing: true, speed: 1.0, filename: '', density: [] }),
}));
