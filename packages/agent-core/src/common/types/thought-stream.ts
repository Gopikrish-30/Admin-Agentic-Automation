/**
 * Types for the thought stream API used to stream thought/checkpoint events
 * to the Electron UI in real time.
 */

export interface ThoughtEvent {
  taskId: string;
  content: string;
  category: 'observation' | 'reasoning' | 'decision' | 'action';
  agentName: string;
  timestamp: number;
}

export interface CheckpointEvent {
  taskId: string;
  status: 'progress' | 'complete' | 'stuck';
  summary: string;
  nextPlanned?: string;
  blocker?: string;
  agentName: string;
  timestamp: number;
}
