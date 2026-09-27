// Item definitions. Weights are kilograms. Hunger/thirst values are fractions of the 0..1 need meters.

export type ItemCat =
  | 'food' | 'drink' | 'weapon' | 'firearm' | 'ammo' | 'medical' | 'tool' | 'material' | 'clothing'
  | 'bag' | 'misc' | 'book' | 'key' | 'seed' | 'container' | 'part' | 'placeable';

export type Skill =
  | 'strength' | 'fitness' | 'carpentry' | 'cooking' | 'mechanics' | 'medicine' | 'sneaking'
  | 'foraging' | 'electrical' | 'farming' | 'blunt' | 'blade' | 'firearms';

export type ClothingSlot = 'head' | 'neck' | 'torso' | 'outer' | 'hands' | 'legs' | 'feet';

export type BodyPart =
  | 'head' | 'neck' | 'torso' | 'lArm' | 'rArm' | 'lHand' | 'rHand' | 'lLeg' | 'rLeg' | 'lFoot' | 'rFoot';

export type Liquid = 'water' | 'tainted' | 'fuel' | 'alcohol';

export interface WeaponStats {
  dmg: number;
  reach: number;
  swing: number;
  stam: number;
  knock: number;
  crit: number;
  /** Average number of hits before breaking. */
  dur: number;
  twoHanded: boolean;
  skill: 'blunt' | 'blade';
  noise: number;
  /** Max zombies hit per swing. */
  arc: number;
  /** Can be used to stab (quiet, precise). */
  stab?: boolean;
}

export interface FirearmStats {
  dmg: number;
  range: number;
  noise: number;
  ammo: string;
  mag: number;
  spread: number;
  reload: number;
  rate: number;
  pellets: number;
}

export interface ItemDef {
  id: string;
  name: string;
  weight: number;
  cat: ItemCat;
  stack?: number;
  desc?: string;
  food?: {
    hunger: number;
    thirst?: number;
    /** Days until stale (fresh food). */
    spoil?: number;
    needsCooking?: boolean;
    /** Chance of food poisoning if eaten raw/unsafe. */
    poison?: number;
    stress?: number;
    canned?: boolean;
    /** Leaves an empty can behind. */
    leaves?: string;
    drunk?: number;
  };
  weapon?: WeaponStats;
  firearm?: FirearmStats;
  medical?: 'bandage' | 'rag' | 'disinfect' | 'wipe' | 'painkiller' | 'antibiotic' | 'splint' | 'suture' | 'tweezers' | 'betablocker' | 'purify';
  uses?: number;
  clothing?: {
    slot: ClothingSlot;
    ins: number;
    scratch: number;
    bite: number;
    water: number;
    covers: BodyPart[];
  };
  bag?: { cap: number; red: number };
  tools?: string[];
  liquid?: { cap: number };
  light?: { range: number; drain: number };
  book?: { skill: Skill; mult: number; maxLevel: number; hours: number };
  magazine?: string;
  seed?: string;
  fuelValue?: number;
  throwNoise?: number;
}

const defs: ItemDef[] = [];
const add = (d: ItemDef): void => {
  defs.push(d);
};

// ---------------------------------------------------------------- food
const food = (id: string, name: string, weight: number, f: NonNullable<ItemDef['food']>, desc?: string): void =>
  add({ id, name, weight, cat: 'food', food: f, desc });

food('beans', 'Canned beans', 0.45, { hunger: 0.3, canned: true, leaves: 'emptyCan' }, 'Needs a can opener. Opening it with a knife is possible — and risky.');
food('soup', 'Canned soup', 0.45, { hunger: 0.24, thirst: 0.06, canned: true, leaves: 'emptyCan' });
food('tuna', 'Canned tuna', 0.2, { hunger: 0.17, canned: true, leaves: 'emptyCan' });
food('peaches', 'Canned peaches', 0.45, { hunger: 0.17, thirst: 0.1, canned: true, leaves: 'emptyCan', stress: -0.03 });
food('chili', 'Canned chili', 0.45, { hunger: 0.32, canned: true, leaves: 'emptyCan' });
food('dogfood', 'Dog food', 0.45, { hunger: 0.25, canned: true, leaves: 'emptyCan', stress: 0.08 }, 'Edible. Barely.');
food('crackers', 'Crackers', 0.25, { hunger: 0.12, thirst: -0.05 });
food('chips', 'Potato chips', 0.15, { hunger: 0.08, thirst: -0.05, stress: -0.02 });
food('cereal', 'Box of cereal', 0.4, { hunger: 0.2, thirst: -0.03 });
food('pbutter', 'Peanut butter', 0.5, { hunger: 0.3, thirst: -0.06 });
food('chocolate', 'Chocolate bar', 0.1, { hunger: 0.06, stress: -0.08 });
food('granola', 'Granola bar', 0.06, { hunger: 0.07 });
food('jerky', 'Beef jerky', 0.1, { hunger: 0.11, thirst: -0.05 });
food('bread', 'Loaf of bread', 0.4, { hunger: 0.2, spoil: 4 });
food('apple', 'Apple', 0.2, { hunger: 0.08, thirst: 0.04, spoil: 10 });
food('banana', 'Banana', 0.15, { hunger: 0.08, spoil: 5 });
food('orange', 'Orange', 0.2, { hunger: 0.07, thirst: 0.06, spoil: 9 });
food('carrot', 'Carrot', 0.1, { hunger: 0.05, spoil: 12 });
food('potato', 'Potato', 0.25, { hunger: 0.1, spoil: 20 });
food('tomato', 'Tomato', 0.15, { hunger: 0.05, thirst: 0.03, spoil: 6 });
food('cabbage', 'Cabbage', 0.8, { hunger: 0.15, spoil: 14 });
food('cheese', 'Cheese', 0.25, { hunger: 0.12, spoil: 10 });
food('steak', 'Raw steak', 0.4, { hunger: 0.3, spoil: 2, needsCooking: true, poison: 0.55 }, 'Cook it first. Raw meat can make you very sick.');
food('chicken', 'Raw chicken', 0.5, { hunger: 0.3, spoil: 2, needsCooking: true, poison: 0.8 }, 'Cook it thoroughly. Raw poultry is dangerous.');
food('rice', 'Bag of rice', 1.0, { hunger: 0.55, needsCooking: true, poison: 0 }, 'Must be cooked in a pot of water.');
food('pasta', 'Box of pasta', 0.5, { hunger: 0.4, needsCooking: true, poison: 0 }, 'Must be cooked in a pot of water.');
food('berries', 'Wild berries', 0.1, { hunger: 0.05, spoil: 3, poison: 0.3 }, 'Unidentified. Some wild berries are poisonous.');
food('mushrooms', 'Wild mushrooms', 0.1, { hunger: 0.05, spoil: 3, poison: 0.35 }, 'Unidentified. Some mushrooms are deadly.');
food('mre', 'Military ration', 0.6, { hunger: 0.45 });
food('stew', 'Pot of stew', 1.5, { hunger: 0.55, thirst: 0.1, stress: -0.08, spoil: 2 });

// ---------------------------------------------------------------- drinks
add({ id: 'soda', name: 'Can of soda', weight: 0.35, cat: 'drink', food: { hunger: 0.02, thirst: 0.22, stress: -0.02, leaves: 'emptyCan' } });
add({ id: 'juice', name: 'Carton of juice', weight: 1.0, cat: 'drink', food: { hunger: 0.05, thirst: 0.45, spoil: 8 } });
add({ id: 'milk', name: 'Carton of milk', weight: 1.0, cat: 'drink', food: { hunger: 0.08, thirst: 0.35, spoil: 3 } });
add({ id: 'beer', name: 'Bottle of beer', weight: 0.4, cat: 'drink', food: { hunger: 0.02, thirst: 0.12, stress: -0.08, drunk: 0.18, leaves: 'emptyBottle' } });

// ---------------------------------------------------------------- liquid containers
add({ id: 'waterBottle', name: 'Water bottle', weight: 0.05, cat: 'container', liquid: { cap: 0.75 }, throwNoise: 6, desc: 'Holds 0.75 L.' });
add({ id: 'jug', name: 'Water jug', weight: 0.2, cat: 'container', liquid: { cap: 4 }, desc: 'Holds 4 L. Heavy when full.' });
add({ id: 'pot', name: 'Cooking pot', weight: 0.8, cat: 'container', liquid: { cap: 2 }, tools: ['pot'], desc: 'Boil water or cook meals. Holds 2 L.' });
add({ id: 'bucket', name: 'Bucket', weight: 0.6, cat: 'container', liquid: { cap: 8 }, tools: ['bucket'] });
add({ id: 'gasCan', name: 'Gas can', weight: 1.0, cat: 'container', liquid: { cap: 10 }, desc: 'Holds 10 L of fuel.' });
add({ id: 'whiskey', name: 'Bottle of whiskey', weight: 0.2, cat: 'container', liquid: { cap: 0.7 }, desc: 'Drinkable. Also a crude disinfectant.' });
add({ id: 'emptyBottle', name: 'Empty glass bottle', weight: 0.3, cat: 'misc', throwNoise: 14, desc: 'Throw it to make a distracting crash.' });
add({ id: 'emptyCan', name: 'Empty tin can', weight: 0.05, cat: 'misc', throwNoise: 6, desc: 'Several can be strung together as an alarm.' });

// ---------------------------------------------------------------- medical
add({ id: 'bandage', name: 'Sterile bandage', weight: 0.05, cat: 'medical', medical: 'bandage', stack: 10, desc: 'Stops bleeding. Clean.' });
add({ id: 'rag', name: 'Rag', weight: 0.05, cat: 'medical', medical: 'rag', stack: 20, desc: 'Improvised bandage. Dirty unless disinfected — wounds under it can fester.' });
add({ id: 'cleanRag', name: 'Sterilized rag', weight: 0.05, cat: 'medical', medical: 'bandage', stack: 20, desc: 'A rag cleaned with alcohol or boiling water.' });
add({ id: 'disinfectant', name: 'Disinfectant', weight: 0.3, cat: 'medical', medical: 'disinfect', uses: 10, desc: 'Clean a wound before bandaging to prevent infection.' });
add({ id: 'wipes', name: 'Alcohol wipe', weight: 0.01, cat: 'medical', medical: 'wipe', stack: 20, desc: 'Single-use disinfectant.' });
add({ id: 'painkillers', name: 'Painkillers', weight: 0.1, cat: 'medical', medical: 'painkiller', uses: 10 });
add({ id: 'antibiotics', name: 'Antibiotics', weight: 0.1, cat: 'medical', medical: 'antibiotic', uses: 6, desc: 'Fights wound infections. Useless against the fever carried by bites.' });
add({ id: 'splint', name: 'Splint', weight: 0.5, cat: 'medical', medical: 'splint', desc: 'Immobilises a fracture so it can heal.' });
add({ id: 'suture', name: 'Suture kit', weight: 0.1, cat: 'medical', medical: 'suture', uses: 4, desc: 'Close deep wounds. Needs a steady hand.' });
add({ id: 'tweezers', name: 'Tweezers', weight: 0.02, cat: 'medical', medical: 'tweezers', desc: 'Remove glass shards and debris from wounds.' });
add({ id: 'betablockers', name: 'Beta blockers', weight: 0.05, cat: 'medical', medical: 'betablocker', uses: 8, desc: 'Takes the edge off panic for a few hours.' });
add({ id: 'purifyTabs', name: 'Purification tablets', weight: 0.01, cat: 'medical', medical: 'purify', stack: 20, desc: 'Makes up to 1 L of water safe to drink.' });
add({ id: 'bleach', name: 'Bleach', weight: 1.0, cat: 'tool', uses: 20, tools: ['bleach'], desc: 'A few drops purify water. Never drink it.' });

// ---------------------------------------------------------------- melee weapons
const W = (
  id: string, name: string, weight: number, w: Partial<WeaponStats> & Pick<WeaponStats, 'dmg' | 'reach' | 'swing' | 'dur'>,
  extra: Partial<ItemDef> = {},
): void =>
  add({
    id, name, weight, cat: 'weapon',
    weapon: { stam: 0.02 + weight * 0.012, knock: 0.3, crit: 0.15, twoHanded: false, skill: 'blunt', noise: 7, arc: 1, ...w },
    ...extra,
  });

W('knife', 'Kitchen knife', 0.3, { dmg: 0.55, reach: 0.9, swing: 0.45, dur: 40, knock: 0.02, crit: 0.28, skill: 'blade', noise: 3, stab: true, stam: 0.012 }, { tools: ['knife'] });
W('huntknife', 'Hunting knife', 0.4, { dmg: 0.75, reach: 0.95, swing: 0.45, dur: 110, knock: 0.03, crit: 0.32, skill: 'blade', noise: 3, stab: true, stam: 0.013 }, { tools: ['knife'] });
W('machete', 'Machete', 1.0, { dmg: 1.1, reach: 1.2, swing: 0.72, dur: 100, knock: 0.2, crit: 0.22, skill: 'blade', noise: 6, arc: 2 }, { tools: ['knife'] });
W('axe', 'Fire axe', 2.6, { dmg: 1.7, reach: 1.3, swing: 1.05, dur: 220, knock: 0.45, crit: 0.25, twoHanded: true, skill: 'blade', noise: 8, arc: 2, stam: 0.055 }, { tools: ['axe'] });
W('hatchet', 'Hatchet', 1.0, { dmg: 1.0, reach: 1.0, swing: 0.7, dur: 140, knock: 0.25, crit: 0.2, skill: 'blade', noise: 6 }, { tools: ['axe'] });
W('bat', 'Baseball bat', 1.0, { dmg: 0.9, reach: 1.35, swing: 0.85, dur: 120, knock: 0.55, twoHanded: true, noise: 8, arc: 2, stam: 0.032 });
W('crowbar', 'Crowbar', 1.8, { dmg: 1.0, reach: 1.2, swing: 0.9, dur: 450, knock: 0.45, noise: 8, stam: 0.036 }, { tools: ['crowbar'], desc: 'Pries open locked doors quietly-ish. Nearly indestructible.' });
W('hammer', 'Hammer', 0.7, { dmg: 0.7, reach: 1.0, swing: 0.62, dur: 160, knock: 0.25, crit: 0.2, noise: 7 }, { tools: ['hammer'], desc: 'Needed for barricading and carpentry.' });
W('pipe', 'Lead pipe', 1.5, { dmg: 0.8, reach: 1.2, swing: 0.85, dur: 220, knock: 0.4, noise: 8 });
W('wrench', 'Pipe wrench', 1.4, { dmg: 0.7, reach: 1.05, swing: 0.78, dur: 260, knock: 0.3, noise: 8 }, { tools: ['wrench'] });
W('shovel', 'Shovel', 2.0, { dmg: 0.9, reach: 1.45, swing: 1.0, dur: 130, knock: 0.55, twoHanded: true, noise: 9, arc: 2, stam: 0.045 }, { tools: ['shovel'] });
W('sledge', 'Sledgehammer', 5.0, { dmg: 2.3, reach: 1.4, swing: 1.6, dur: 320, knock: 0.9, twoHanded: true, noise: 11, arc: 2, stam: 0.095 }, { tools: ['sledge'], desc: 'Devastating and exhausting. Can demolish walls.' });
W('plank', 'Plank', 1.2, { dmg: 0.45, reach: 1.3, swing: 0.8, dur: 22, knock: 0.35, twoHanded: true, noise: 7 }, { cat: 'material', stack: 10, fuelValue: 1.5, desc: 'Building material. A poor weapon in a pinch.' });
W('pan', 'Frying pan', 1.1, { dmg: 0.55, reach: 1.0, swing: 0.75, dur: 120, knock: 0.35, noise: 10 }, { tools: ['pan'] });
W('golfclub', 'Golf club', 0.9, { dmg: 0.65, reach: 1.35, swing: 0.8, dur: 50, knock: 0.35, twoHanded: true, noise: 7 });
W('baton', 'Police baton', 0.6, { dmg: 0.6, reach: 1.1, swing: 0.58, dur: 260, knock: 0.35, noise: 7 });
W('screwdriver', 'Screwdriver', 0.2, { dmg: 0.4, reach: 0.85, swing: 0.45, dur: 30, knock: 0.02, crit: 0.25, skill: 'blade', noise: 3, stab: true, stam: 0.012 }, { tools: ['screwdriver'] });
W('spear', 'Crafted spear', 1.2, { dmg: 0.85, reach: 1.75, swing: 0.85, dur: 45, knock: 0.15, crit: 0.2, twoHanded: true, skill: 'blade', noise: 5, stab: true }, { desc: 'Long reach keeps them at a distance.' });
W('branch', 'Tree branch', 0.8, { dmg: 0.35, reach: 1.2, swing: 0.75, dur: 12, knock: 0.3, twoHanded: true, noise: 6 }, { fuelValue: 1 });

// ---------------------------------------------------------------- firearms
const F = (id: string, name: string, weight: number, f: FirearmStats, desc: string): void =>
  add({ id, name, weight, cat: 'firearm', firearm: f, desc });
F('pistol', '9mm pistol', 1.0, { dmg: 2.2, range: 16, noise: 48, ammo: 'ammo9', mag: 15, spread: 0.07, reload: 2.2, rate: 0.35, pellets: 1 }, 'Every shot is heard for blocks around.');
F('revolver', '.38 revolver', 1.1, { dmg: 2.7, range: 15, noise: 52, ammo: 'ammo38', mag: 6, spread: 0.06, reload: 3.0, rate: 0.5, pellets: 1 }, 'Every shot is heard for blocks around.');
F('shotgun', 'Pump shotgun', 3.4, { dmg: 0.9, range: 9, noise: 62, ammo: 'shells', mag: 6, spread: 0.2, reload: 4.0, rate: 0.95, pellets: 7 }, 'Devastating up close. Unbelievably loud.');
F('rifle', 'Hunting rifle', 3.8, { dmg: 4.5, range: 30, noise: 70, ammo: 'ammo308', mag: 5, spread: 0.025, reload: 3.4, rate: 1.3, pellets: 1 }, 'Accurate at range. Every zombie for half a mile will hear it.');
add({ id: 'ammo9', name: '9mm rounds', weight: 0.012, cat: 'ammo', stack: 100 });
add({ id: 'ammo38', name: '.38 rounds', weight: 0.013, cat: 'ammo', stack: 100 });
add({ id: 'shells', name: 'Shotgun shells', weight: 0.04, cat: 'ammo', stack: 50 });
add({ id: 'ammo308', name: '.308 rounds', weight: 0.025, cat: 'ammo', stack: 60 });

// ---------------------------------------------------------------- tools & materials
add({ id: 'saw', name: 'Saw', weight: 0.8, cat: 'tool', tools: ['saw'], desc: 'Turns logs into planks and cuts furniture down.' });
add({ id: 'canopener', name: 'Can opener', weight: 0.1, cat: 'tool', tools: ['canopener'] });
add({ id: 'lighter', name: 'Lighter', weight: 0.05, cat: 'tool', tools: ['lighter'], uses: 60 });
add({ id: 'matches', name: 'Matches', weight: 0.03, cat: 'tool', tools: ['lighter'], uses: 20 });
add({ id: 'flashlight', name: 'Flashlight', weight: 0.4, cat: 'tool', light: { range: 14, drain: 0.05 }, desc: 'Lights your way — and makes you visible from far away.' });
add({ id: 'battery', name: 'Battery', weight: 0.05, cat: 'part', stack: 10 });
add({ id: 'jack', name: 'Car jack', weight: 3.0, cat: 'tool', tools: ['jack'] });
add({ id: 'lugwrench', name: 'Lug wrench', weight: 1.0, cat: 'tool', tools: ['lugwrench'] });
add({ id: 'nails', name: 'Nails', weight: 0.01, cat: 'material', stack: 200 });
add({ id: 'log', name: 'Log', weight: 6.0, cat: 'material', fuelValue: 5, stack: 4 });
add({ id: 'sheet', name: 'Bed sheet', weight: 0.5, cat: 'material', fuelValue: 0.4, desc: 'Hang over a window as a curtain, or rip into rags.' });
add({ id: 'ducttape', name: 'Duct tape', weight: 0.2, cat: 'material', uses: 10 });
add({ id: 'garbageBag', name: 'Garbage bag', weight: 0.05, cat: 'material', stack: 20 });
add({ id: 'scrap', name: 'Scrap metal', weight: 1.0, cat: 'material', stack: 10 });
add({ id: 'twine', name: 'Twine', weight: 0.1, cat: 'material', uses: 4 });
add({ id: 'engineParts', name: 'Engine parts', weight: 2.0, cat: 'part', stack: 5, desc: 'Used to repair a damaged engine.' });
add({ id: 'carBattery', name: 'Car battery', weight: 14.0, cat: 'part' });
add({ id: 'tire', name: 'Spare tire', weight: 10.0, cat: 'part' });
add({ id: 'extinguisher', name: 'Fire extinguisher', weight: 4.5, cat: 'tool', uses: 6, tools: ['extinguisher'] });
add({ id: 'stick', name: 'Twigs', weight: 0.2, cat: 'material', fuelValue: 0.4, stack: 10 });
add({ id: 'charcoal', name: 'Bag of charcoal', weight: 3.0, cat: 'material', fuelValue: 6 });
add({ id: 'newspaper', name: 'Newspaper', weight: 0.2, cat: 'misc', fuelValue: 0.3, desc: 'Yesterday\'s headlines: "RIOTS SPREAD — AUTHORITIES URGE CALM".' });
add({ id: 'generatorItem', name: 'Portable generator', weight: 32, cat: 'placeable', desc: 'Place outdoors next to a building and connect it. Running one indoors is lethal.' });
add({ id: 'sleepbagItem', name: 'Sleeping bag', weight: 2.5, cat: 'placeable', desc: 'Place it to sleep somewhere better than the floor.' });
add({ id: 'rainbarrelItem', name: 'Rain collector (kit)', weight: 12, cat: 'placeable' });
add({ id: 'woodcrateItem', name: 'Wooden crate (flat-pack)', weight: 20, cat: 'placeable' });
add({ id: 'alarmtrapItem', name: 'Tin-can alarm line', weight: 1.5, cat: 'placeable', desc: 'Rattles loudly when something walks through it. Wakes you up.' });

// ---------------------------------------------------------------- clothing
const C = (
  id: string, name: string, weight: number, slot: ClothingSlot, ins: number, scratch: number, bite: number, covers: BodyPart[], water = 0, desc?: string,
): void => add({ id, name, weight, cat: 'clothing', clothing: { slot, ins, scratch, bite, water, covers }, desc });
const ARMS: BodyPart[] = ['lArm', 'rArm'];
C('tshirt', 'T-shirt', 0.2, 'torso', 0.6, 0.05, 0, ['torso']);
C('shirt', 'Button-up shirt', 0.3, 'torso', 1.2, 0.1, 0.02, ['torso', ...ARMS]);
C('hoodie', 'Hoodie', 0.6, 'torso', 3.0, 0.15, 0.05, ['torso', ...ARMS]);
C('sweater', 'Wool sweater', 0.6, 'torso', 3.5, 0.12, 0.04, ['torso', ...ARMS]);
C('denimJacket', 'Denim jacket', 1.1, 'outer', 2.5, 0.3, 0.12, ['torso', ...ARMS]);
C('leatherJacket', 'Leather jacket', 1.8, 'outer', 3.5, 0.55, 0.3, ['torso', ...ARMS], 0.3, 'Thick leather turns aside many scratches and some bites.');
C('winterCoat', 'Winter coat', 2.0, 'outer', 9, 0.35, 0.15, ['torso', ...ARMS], 0.4);
C('raincoat', 'Raincoat', 0.6, 'outer', 1.5, 0.1, 0.02, ['torso', ...ARMS], 0.9, 'Keeps you dry. Wet clothes steal body heat fast.');
C('vest', 'Kevlar vest', 3.0, 'outer', 1.5, 0.7, 0.6, ['torso'], 0, 'Excellent torso protection. Does nothing for your arms.');
C('jeans', 'Jeans', 0.7, 'legs', 2.0, 0.28, 0.12, ['lLeg', 'rLeg']);
C('slacks', 'Slacks', 0.5, 'legs', 1.5, 0.1, 0.03, ['lLeg', 'rLeg']);
C('shorts', 'Shorts', 0.3, 'legs', 0.3, 0.02, 0, ['lLeg', 'rLeg']);
C('workPants', 'Padded work pants', 1.0, 'legs', 3.0, 0.4, 0.2, ['lLeg', 'rLeg']);
C('sneakers', 'Sneakers', 0.6, 'feet', 0.8, 0.2, 0.05, ['lFoot', 'rFoot']);
C('boots', 'Work boots', 1.4, 'feet', 1.5, 0.6, 0.4, ['lFoot', 'rFoot'], 0.5, 'Sturdy. Slightly louder on hard floors.');
C('dressShoes', 'Dress shoes', 0.7, 'feet', 0.6, 0.15, 0.05, ['lFoot', 'rFoot']);
C('gloves', 'Work gloves', 0.2, 'hands', 1.0, 0.6, 0.2, ['lHand', 'rHand'], 0, 'Protects your hands from glass and scratches.');
C('leatherGloves', 'Leather gloves', 0.25, 'hands', 1.5, 0.7, 0.3, ['lHand', 'rHand']);
C('beanie', 'Beanie', 0.1, 'head', 2.0, 0.05, 0, ['head']);
C('cap', 'Baseball cap', 0.1, 'head', 0.5, 0.05, 0, ['head']);
C('helmet', 'Riot helmet', 1.2, 'head', 1.0, 0.85, 0.8, ['head'], 0, 'Blocks most head injuries. Narrows your field of view slightly.');
C('scarf', 'Scarf', 0.15, 'neck', 1.5, 0.3, 0.2, ['neck'], 0, 'Warm, and a thin layer between your neck and their teeth.');

// ---------------------------------------------------------------- bags
add({ id: 'plasticBag', name: 'Plastic bag', weight: 0.05, cat: 'bag', bag: { cap: 4, red: 0 } });
add({ id: 'schoolBag', name: 'School backpack', weight: 0.6, cat: 'bag', bag: { cap: 12, red: 0.3 } });
add({ id: 'duffel', name: 'Duffel bag', weight: 1.0, cat: 'bag', bag: { cap: 18, red: 0.35 } });
add({ id: 'hikingBag', name: 'Hiking backpack', weight: 1.5, cat: 'bag', bag: { cap: 24, red: 0.45 } });
add({ id: 'militaryPack', name: 'Military rucksack', weight: 2.0, cat: 'bag', bag: { cap: 30, red: 0.5 } });

// ---------------------------------------------------------------- misc
add({ id: 'watch', name: 'Wristwatch', weight: 0.05, cat: 'misc', desc: 'Keep it in your inventory to see the exact time.' });
add({ id: 'radio', name: 'Portable radio', weight: 0.9, cat: 'misc', desc: 'Emergency broadcasts: weather and warnings — while they last.' });
add({ id: 'map', name: 'Map of Cedar Hollow', weight: 0.05, cat: 'misc', desc: 'Reveals the roads and buildings of town on your map.' });
add({ id: 'houseKey', name: 'House key', weight: 0.02, cat: 'key' });
add({ id: 'carKey', name: 'Car key', weight: 0.02, cat: 'key' });
add({ id: 'cigarettes', name: 'Cigarettes', weight: 0.05, cat: 'misc', uses: 20, desc: 'Calms a smoker. Needs a lighter.' });
add({ id: 'comics', name: 'Comic book', weight: 0.1, cat: 'misc', desc: 'Reading relieves stress.' });
add({ id: 'alarmClock', name: 'Alarm clock', weight: 0.4, cat: 'misc', throwNoise: 5, desc: 'Set it and drop it: it rings loudly after a delay. A distraction.' });
add({ id: 'molotov', name: 'Molotov cocktail', weight: 0.6, cat: 'misc', throwNoise: 15, desc: 'Throw to start a fire. Fires spread. Choose your target carefully.' });

// ---------------------------------------------------------------- books & magazines
const B = (id: string, name: string, skill: Skill, maxLevel: number): void =>
  add({ id, name, weight: 0.4, cat: 'book', book: { skill, mult: 3, maxLevel, hours: 3 }, desc: `Reading it triples ${skill} experience gained up to level ${maxLevel}.` });
B('bookCarp1', 'Carpentry for Beginners', 'carpentry', 3);
B('bookCarp2', 'Advanced Joinery', 'carpentry', 6);
B('bookMech1', 'Engine Repair Basics', 'mechanics', 3);
B('bookMed1', 'First Aid Handbook', 'medicine', 3);
B('bookElec1', 'Wiring for Homeowners', 'electrical', 3);
B('bookCook1', 'Home Cooking', 'cooking', 3);
B('bookFarm1', 'Backyard Gardening', 'farming', 3);
B('bookForage1', 'Field Guide to Wild Plants', 'foraging', 3);
add({ id: 'magGenerator', name: 'Magazine: Generator Guide', weight: 0.1, cat: 'book', magazine: 'generator', desc: 'Teaches how to connect a generator safely.' });
add({ id: 'magHotwire', name: 'Magazine: Car Wiring Explained', weight: 0.1, cat: 'book', magazine: 'hotwire', desc: 'Teaches how to hotwire a car.' });
add({ id: 'magTraps', name: 'Magazine: Backwoods Alarms', weight: 0.1, cat: 'book', magazine: 'traps', desc: 'Teaches how to build tin-can alarm lines.' });

// ---------------------------------------------------------------- seeds
add({ id: 'seedCarrot', name: 'Carrot seeds', weight: 0.02, cat: 'seed', seed: 'carrot', stack: 10 });
add({ id: 'seedPotato', name: 'Seed potatoes', weight: 0.2, cat: 'seed', seed: 'potato', stack: 10 });
add({ id: 'seedTomato', name: 'Tomato seeds', weight: 0.02, cat: 'seed', seed: 'tomato', stack: 10 });
add({ id: 'seedCabbage', name: 'Cabbage seeds', weight: 0.02, cat: 'seed', seed: 'cabbage', stack: 10 });

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

export function def(id: string): ItemDef {
  const d = ITEMS[id];
  if (!d) throw new Error(`Unknown item ${id}`);
  return d;
}

export interface Item {
  uid: number;
  id: string;
  qty: number;
  /** Condition 0..1 (durability for weapons, charge for flashlights). */
  cond: number;
  /** Hours since the item was fresh (food ageing). */
  age: number;
  fill?: number;
  liquid?: Liquid;
  cooked?: boolean;
  burnt?: boolean;
  keyId?: number;
  label?: string;
  contents?: Item[];
  ammo?: number;
  usesLeft?: number;
  /** For foraged food: whether it is known safe. */
  safe?: boolean;
  /** Battery charge for lights/radios. */
  charge?: number;
  /** Alarm clock countdown. */
  timer?: number;
}

export interface UidSource {
  nextUid: number;
}

export function makeItem(src: UidSource, id: string, opts: Partial<Item> = {}): Item {
  const d = def(id);
  const it: Item = { uid: src.nextUid++, id, qty: 1, cond: 1, age: 0, ...opts };
  if (d.uses !== undefined && it.usesLeft === undefined) it.usesLeft = d.uses;
  if (d.light && it.charge === undefined) it.charge = 1;
  if (d.firearm && it.ammo === undefined) it.ammo = 0;
  if (d.id === 'whiskey' && it.fill === undefined) {
    it.fill = 0.7;
    it.liquid = 'alcohol';
  }
  return it;
}

/** Weight of one item stack, including liquid and nested contents. */
export function itemWeight(it: Item): number {
  const d = def(it.id);
  let w = d.weight * it.qty;
  if (it.fill) w += it.fill * (it.liquid === 'fuel' ? 0.75 : 1);
  if (it.contents && d.bag) {
    let inner = 0;
    for (const c of it.contents) inner += itemWeight(c);
    w += inner * (1 - d.bag.red);
  }
  return w;
}

export function itemName(it: Item): string {
  const d = def(it.id);
  let n = it.label ?? d.name;
  if (d.food?.needsCooking && it.cooked) n = n.replace('Raw ', 'Cooked ');
  if (it.burnt) n = 'Burnt ' + n.toLowerCase();
  if (it.qty > 1) n += ` ×${it.qty}`;
  if (d.liquid) {
    if (it.fill && it.fill > 0.001) {
      const what = it.liquid === 'tainted' ? 'untreated water' : it.liquid === 'fuel' ? 'gasoline' : it.liquid === 'alcohol' ? 'alcohol' : 'water';
      n += ` (${it.fill.toFixed(1)} L ${what})`;
    } else if (d.id !== 'whiskey') n += ' (empty)';
    else n = 'Empty whiskey bottle';
  }
  return n;
}

export function hasTool(items: Item[], tool: string): Item | null {
  for (const it of items) {
    const d = def(it.id);
    if (d.tools && d.tools.includes(tool) && it.cond > 0) {
      if (d.uses !== undefined && (it.usesLeft ?? 0) <= 0) continue;
      return it;
    }
  }
  return null;
}

/** Food freshness state from age in hours. */
export function freshness(it: Item, d = def(it.id)): 'fresh' | 'stale' | 'rotten' | 'none' {
  if (!d.food?.spoil) return 'none';
  const days = it.age / 24;
  if (days < d.food.spoil) return 'fresh';
  if (days < d.food.spoil * 2) return 'stale';
  return 'rotten';
}
