import type { World } from '../world/world';
import type { BodyPart, ClothingSlot, Item, Skill } from './items';

export type InjuryType = 'scratch' | 'cut' | 'deep' | 'burn' | 'sprain' | 'fracture' | 'bite' | 'bruise';

export interface Injury {
  id: number;
  part: BodyPart;
  type: InjuryType;
  /** 0..1 */
  severity: number;
  /** Blood loss per game hour (fraction of total blood). */
  bleed: number;
  bandaged: boolean;
  /** Bandage is dirty/unsterile. */
  dirtyBandage: boolean;
  /** Game hours since the bandage was applied (soaks through over time). */
  bandageAge: number;
  disinfected: boolean;
  /** 0..1 wound infection (bacterial, treatable). */
  infection: number;
  glass: boolean;
  stitched: boolean;
  splinted: boolean;
  /** Healing progress 0..1. */
  heal: number;
  /** Game time the injury happened. */
  t: number;
  cause: string;
}

export interface Body {
  injuries: Injury[];
  /** Overall health 0..100. */
  health: number;
  /** Blood volume 0..1. */
  blood: number;
  /** Carrying the fever from a bite. */
  fever: boolean;
  /** Game time the fever was contracted. */
  feverT: number;
  /** Fever progress 0..1 once symptoms begin. */
  feverLevel: number;
  nextInjuryId: number;
}

export interface Needs {
  hunger: number;
  thirst: number;
  /** Sleepiness 0..1. */
  fatigue: number;
  /** Short-term stamina 0..1. */
  endurance: number;
  /** Core body temperature °C. */
  temp: number;
  wet: number;
  stress: number;
  panic: number;
  /** Food poisoning / illness 0..1. */
  sick: number;
  sickCause: string;
  /** Common cold from exposure 0..1. */
  cold: number;
  drunk: number;
  /** Game hours of painkiller effect left. */
  painkiller: number;
  /** Game hours of beta-blocker effect left. */
  calm: number;
  /** Game hours of antibiotic effect left. */
  antibiotic: number;
  /** Carbon monoxide exposure 0..1. */
  co: number;
  /** Smoker craving 0..1. */
  craving: number;
  boredom: number;
}

export type Stance = 'stand' | 'crouch';

export interface Player {
  name: string;
  occupation: string;
  traits: string[];
  x: number;
  y: number;
  facing: number;
  vx: number;
  vy: number;
  stance: Stance;
  running: boolean;
  inVehicle: number;
  body: Body;
  needs: Needs;
  /** Experience per skill; level is derived. */
  xp: Record<Skill, number>;
  /** Skill-book multipliers read: skill -> max level boosted. */
  bookBoost: Partial<Record<Skill, number>>;
  magazines: string[];
  inventory: Item[];
  /** uid of the item held in hands (0 = empty). */
  primary: number;
  worn: Partial<Record<ClothingSlot, Item>>;
  bag: Item | null;
  flashlight: boolean;
  /** Attack animation timer (seconds remaining) and total. */
  attackT: number;
  attackDur: number;
  attackHit: boolean;
  shoveT: number;
  /** Seconds lying on the ground after a fall. */
  downT: number;
  /** Seconds of a vault/climb animation. */
  climbT: number;
  climbDur: number;
  climbFrom: [number, number];
  climbTo: [number, number];
  climbKind: string;
  climbTile: number;
  aimT: number;
  reloadT: number;
  grabbedBy: number[];
  sleeping: boolean;
  sleepQuality: number;
  sleepUntil: number;
  /** Game time of this survivor's arrival. */
  startT: number;
  kills: number;
  dead: boolean;
  deathCause: string;
  /** Time of last significant exertion (for field notes). */
  lastHitT: number;
  /** Seconds since last heard footstep noise. */
  stepNoiseT: number;
  /** Carried furniture (id) while moving furniture. */
  carrying: number;
  readingUid: number;
}

export type ZState =
  | 'idle' | 'wander' | 'investigate' | 'chase' | 'search' | 'attack' | 'bang' | 'stagger' | 'down'
  | 'climb' | 'dead' | 'eat' | 'lunge';

export type ZKind = 'civ' | 'cop' | 'soldier' | 'medic' | 'worker' | 'farmer' | 'survivor' | 'hazmat';

export interface Zombie {
  id: number;
  x: number;
  y: number;
  facing: number;
  /** Base shamble speed (tiles/s). */
  speed: number;
  hp: number;
  maxHp: number;
  state: ZState;
  timer: number;
  tx: number;
  ty: number;
  /** Priority of the current target (sound loudness / sight = 100). */
  targetPri: number;
  /** Accumulated visual awareness of the player. */
  awareness: number;
  lastSeenX: number;
  lastSeenY: number;
  lastSeenT: number;
  /** Real seconds since this zombie last saw the survivor. */
  sinceSeen: number;
  path: number[] | null;
  pathI: number;
  pathT: number;
  downT: number;
  staggerT: number;
  attackT: number;
  crawler: boolean;
  outfit: number;
  kind: ZKind;
  /** Tile index of the obstacle being banged on. */
  bangIdx: number;
  bangT: number;
  hearing: number;
  sight: number;
  items: Item[] | null;
  name?: string;
  grabbing: boolean;
  vx: number;
  vy: number;
  anim: number;
  moanT: number;
  climbT: number;
  /** Game-seconds accumulator for low-detail updates when far away. */
  lodAcc: number;
  /** Interest decays; when 0 the zombie gives up. */
  interest: number;
  /** Migration group id (-1 none). */
  group: number;
  /** Zombie was a survivor who reanimated. */
  formerPlayer?: boolean;
  stuckT: number;
  lastX: number;
  lastY: number;
}

export interface Corpse {
  id: number;
  x: number;
  y: number;
  rot: number;
  outfit: number;
  kind: ZKind;
  items: Item[] | null;
  /** Items the body carried (keys etc.), merged into the loot when searched. */
  extra?: Item[];
  t: number;
  name?: string;
  wasPlayer?: boolean;
  /** Will reanimate at this game time (infected survivor corpse). */
  riseAt?: number;
  crawler?: boolean;
}

export type VehType = 'sedan' | 'hatch' | 'pickup' | 'van' | 'police' | 'truck' | 'military' | 'sports';

export interface Vehicle {
  id: number;
  type: VehType;
  x: number;
  y: number;
  heading: number;
  speed: number;
  steer: number;
  color: number;
  engineOn: boolean;
  /** Condition 0..100. */
  engine: number;
  battery: number;
  fuel: number;
  fuelCap: number;
  tires: number[];
  body: number;
  front: number;
  rear: number;
  /** Windows: 0 windshield, 1 driver, 2 passenger, 3 rear. 0 intact, 1 cracked, 2 broken. */
  windows: number[];
  locked: boolean;
  keyId: number;
  hotwired: boolean;
  keyInIgnition: boolean;
  hasAlarm: boolean;
  alarmUntil: number;
  lights: boolean;
  trunk: number;
  glovebox: number;
  wrecked: boolean;
  horn: boolean;
  noiseT: number;
  /** Zombies currently beating on the car (for window damage). */
  stallT: number;
}

export interface Fire {
  /** 0..1 intensity. */
  heat: number;
  /** Remaining fuel (seconds of burn). */
  fuel: number;
  t: number;
}

export interface LogEntry {
  t: number;
  text: string;
  kind: 'info' | 'warn' | 'danger' | 'sound' | 'good' | 'radio';
  dir?: number;
}

/** Significant events kept for the death report ("what led here"). */
export interface ChronicleEntry {
  t: number;
  text: string;
  severity: number;
}

export interface WeatherState {
  kind: 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow';
  /** 0..1 precipitation intensity. */
  rain: number;
  fog: number;
  wind: number;
  /** Outside air temperature °C. */
  temp: number;
  cloud: number;
  nextChange: number;
  /** Forecast for the next change (radio). */
  forecast: WeatherState['kind'];
  lightningT: number;
}

export interface UtilityState {
  powerOffAt: number;
  waterOffAt: number;
  powerWarned: boolean;
  waterWarned: boolean;
  powerOff: boolean;
  waterOff: boolean;
  radioEndsAt: number;
}

export interface WorldEventState {
  nextEventT: number;
  heli: { x: number; y: number; vx: number; vy: number; until: number; lingerT: number; active: boolean } | null;
  migrations: { id: number; tx: number; ty: number; until: number }[];
  gunfire: { x: number; y: number; vx: number; vy: number; shotsLeft: number; nextShot: number } | null;
  helicopterDone: boolean;
  lastBroadcastT: number;
}

export interface DeadRecord {
  name: string;
  occupation: string;
  days: number;
  cause: string;
  kills: number;
  worldSeed: number;
  when: string;
  survivorIndex: number;
}

export interface WorldSettings {
  population: number;
  loot: number;
  /** Real minutes per in-game day. */
  dayLength: number;
  powerDays: [number, number];
  waterDays: [number, number];
}

export interface GameState {
  version: number;
  id: string;
  seed: number;
  settings: WorldSettings;
  world: World;
  /** Game hours since the outbreak began (day 1, 00:00 = 0). */
  time: number;
  weather: WeatherState;
  util: UtilityState;
  player: Player;
  zombies: Zombie[];
  corpses: Corpse[];
  vehicles: Vehicle[];
  /** Items lying on the ground, keyed by tile index. */
  floor: Record<number, Item[]>;
  fires: Record<number, Fire>;
  events: WorldEventState;
  log: LogEntry[];
  chronicle: ChronicleEntry[];
  notes: string[];
  survivorIndex: number;
  graveyard: DeadRecord[];
  nextUid: number;
  nextZombieId: number;
  nextCorpseId: number;
  nextGroupId: number;
  rng: number;
  /** Tile the player last slept on, etc. */
  stats: { hitsTaken: number; itemsLooted: number; distance: number; noisesMade: number };
  mapMarkers: { x: number; y: number; label: string }[];
  hasMap: boolean;
  /** Tile -> game time last foraged (foraging depletes an area for a while). */
  foraged: Record<number, number>;
  /** Litres left in the gas station's underground tanks. */
  stationFuel: number;
}
