export type Controller = "connectome" | "rewired" | "random" | "servo";
export type Intervention =
  "none" | "blind" | "left-eye" | "silence" | "outputs";
export type Gate = {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
};
export type Course = {
  seed: number;
  difficulty: string;
  gates: Gate[];
  obstacles: {
    x: number;
    y: number;
    z: number;
    radius: number;
    height: number;
  }[];
  length: number;
  width: number;
  height: number;
};
export type Frame = {
  checkpointHash?: string;
  type: "frame";
  sequence: number;
  time: number;
  observedTime: number;
  position: number[];
  quaternion: number[];
  velocity: number[];
  motors: number[];
  command: number[];
  gateIndex: number;
  passed: number;
  missed: number;
  status: string;
  collision: string | null;
  distance: number;
  energy: number;
  camera: string;
  observation: number[];
  vision: { bbox: number[] | null; pixels: number; visible: boolean };
  activity: number[];
  controller: Controller;
  intervention: Intervention;
  running: boolean;
  gust: number;
};
export type Graph = {
  nodes: {
    id: number;
    type: string;
    position: number[];
    role: string;
    sign: number;
    nt: string;
  }[];
  edges: [number, number, number][];
  inputs: [number, number][];
  outputs: number[];
};
export type CircuitData = {
  graph: Graph;
  hash: string;
  channels: string[];
  manifest: { nodes: number; edges: number; synapticContacts: number };
};
export type Condition = {
  controller: Controller;
  intervention: Intervention;
  courses: number;
  completions: number;
  completionRate: number;
  completionCI95: number[];
  meanGates: number;
  collisions: number;
  meanTime: number;
};
export type Report = {
  checkpointHash?: string;
  conditions: Condition[];
  evaluationSeeds?: number[];
  scope?: string;
};
export type Job = {
  status: string;
  mode?: string;
  current?: number;
  total?: number;
  message: string;
  history?: { phase: string; current?: number; mse?: number; kind?: string }[];
};
export type Recording = {
  version: "drone-fly-recording-v1";
  graphHash: string;
  course: Course;
  frames: Frame[];
};
export const NAMES: Record<Controller, string> = {
  connectome: "Fly circuit",
  rewired: "Rewired circuit",
  random: "Random features",
  servo: "Visual servo",
};
export const INTERVENTIONS: Record<Intervention, string> = {
  none: "Intact",
  blind: "Camera blackout",
  "left-eye": "Left camera masked",
  silence: "All cells silenced",
  outputs: "Output cells silenced",
};
