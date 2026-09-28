// Loot tables: what you find depends on the building, the room and the container.
import type { Rng } from '../core/rng';
import { def, makeItem, type Item, type UidSource } from './items';

/** [itemId, weight, minQty?, maxQty?] */
type Entry = [string, number, number?, number?];
interface Table {
  rolls: [number, number];
  empty: number;
  items: Entry[];
}

const T = (rolls: [number, number], empty: number, items: Entry[]): Table => ({ rolls, empty, items });

const CANNED: Entry[] = [['beans', 6], ['soup', 6], ['tuna', 5], ['peaches', 4], ['chili', 4], ['dogfood', 1]];
const DRY: Entry[] = [['crackers', 4], ['chips', 4], ['cereal', 3], ['pbutter', 3], ['pasta', 3], ['rice', 3], ['granola', 3], ['chocolate', 3]];
const MEDS: Entry[] = [['bandage', 6, 1, 3], ['painkillers', 5], ['disinfectant', 4], ['wipes', 4, 2, 6], ['tweezers', 2], ['antibiotics', 1], ['betablockers', 1], ['rag', 2, 1, 3], ['suture', 0.6]];
const TOOLS: Entry[] = [
  ['hammer', 5], ['screwdriver', 5], ['saw', 3], ['wrench', 3], ['crowbar', 1.2], ['nails', 6, 10, 60], ['ducttape', 3],
  ['twine', 2], ['gasCan', 2], ['shovel', 1.5], ['hatchet', 1], ['axe', 0.5], ['lugwrench', 1], ['jack', 1],
  ['gloves', 2], ['flashlight', 2], ['battery', 3, 1, 4], ['garbageBag', 2, 1, 5], ['scrap', 1.5, 1, 3],
  ['magGenerator', 0.6], ['magHotwire', 0.5], ['magTraps', 0.5], ['extinguisher', 0.7], ['engineParts', 0.7], ['carBattery', 0.3],
  ['charcoal', 0.8], ['bucket', 1], ['generatorItem', 0.12], ['pipe', 1], ['sledge', 0.2], ['fishingRod', 0.7],
];
const CLOTHES: Entry[] = [
  ['tshirt', 6], ['shirt', 4], ['hoodie', 4], ['sweater', 3], ['denimJacket', 2], ['leatherJacket', 0.7], ['winterCoat', 1.5],
  ['raincoat', 1.2], ['jeans', 5], ['slacks', 3], ['shorts', 3], ['sneakers', 3], ['boots', 1], ['dressShoes', 2],
  ['beanie', 1.5], ['cap', 2], ['scarf', 1.2], ['sheet', 3], ['schoolBag', 1.5], ['duffel', 0.8], ['hikingBag', 0.25],
  ['gloves', 0.6], ['workPants', 0.4],
];
const BOOKS: Entry[] = [
  ['bookCarp1', 1], ['bookCarp2', 0.4], ['bookMech1', 1], ['bookMed1', 1], ['bookElec1', 1], ['bookCook1', 1],
  ['bookFarm1', 1], ['bookForage1', 1], ['comics', 4], ['newspaper', 4], ['magGenerator', 0.3], ['magHotwire', 0.25], ['magTraps', 0.3],
];

const TABLES: Record<string, Table> = {
  // ------------------------------------------------------------ homes
  'kitchen:fridge': T([1, 4], 0.12, [['milk', 4], ['cheese', 3], ['apple', 3], ['orange', 2], ['tomato', 2], ['carrot', 2], ['steak', 2], ['chicken', 2], ['juice', 3], ['soda', 3], ['beer', 2], ['bread', 1], ['cabbage', 1]]),
  'kitchen:freezer': T([1, 3], 0.2, [['steak', 3], ['chicken', 3]]),
  'kitchen:counter': T([1, 3], 0.3, [...CANNED, ...DRY, ['bread', 2], ['knife', 3], ['canopener', 3], ['pot', 2], ['pan', 1.5], ['waterBottle', 2], ['matches', 2], ['lighter', 1], ['garbageBag', 2, 1, 4], ['bleach', 1.2], ['emptyBottle', 1], ['whiskey', 0.6], ['jug', 0.6], ['purifyTabs', 0.3, 4, 10], ['rag', 1, 1, 2]]),
  'kitchen:oven': T([0, 1], 0.6, [['pan', 3], ['pot', 3]]),
  'bathroom:medicine': T([1, 2], 0.3, MEDS),
  'bedroom:wardrobe': T([1, 4], 0.1, [...CLOTHES, ['bat', 0.7], ['revolver', 0.015], ['pistol', 0.01], ['golfclub', 0.4]]),
  'bedroom:dresser': T([1, 3], 0.15, [...CLOTHES, ['cards', 0.8], ['watch', 1.5], ['cigarettes', 1], ['comics', 1], ['flashlight', 1], ['battery', 1, 1, 2]]),
  'bedroom:nightstand': T([0, 2], 0.3, [['crossword', 1.2], ['cards', 0.8], ['watch', 2], ['painkillers', 2], ['flashlight', 2], ['battery', 2, 1, 3], ['comics', 2], ['alarmClock', 2], ['cigarettes', 1], ['lighter', 1], ['pistol', 0.015], ['ammo9', 0.08, 3, 8], ['ammo38', 0.08, 3, 8], ['betablockers', 0.3], ['radio', 0.4]]),
  'living:bookshelf': T([1, 3], 0.25, [...BOOKS, ['crossword', 1], ['cards', 0.6]]),
  'living:desk': T([0, 2], 0.3, [['cards', 1.5], ['crossword', 1.2], ['battery', 2, 1, 3], ['flashlight', 1], ['map', 0.6], ['radio', 0.8], ['comics', 1], ['newspaper', 1], ['magHotwire', 0.2], ['magGenerator', 0.2], ['lighter', 1]]),
  'office:desk': T([0, 2], 0.3, [['crossword', 1.2], ['cards', 0.5], ['battery', 2, 1, 3], ['flashlight', 1], ['map', 0.5], ['painkillers', 1], ['chocolate', 1], ['comics', 1], ['radio', 0.5]]),
  'garage:workbench': T([1, 4], 0.1, TOOLS),
  'garage:toolchest': T([1, 3], 0.15, TOOLS),
  'garage:shelf': T([1, 3], 0.25, [...TOOLS, ['seedCarrot', 0.6, 2, 6], ['seedTomato', 0.5, 2, 6], ['bucket', 1]]),
  'laundry:washer': T([0, 2], 0.4, [['tshirt', 3], ['jeans', 2], ['sheet', 3], ['hoodie', 1], ['bleach', 1]]),
  'storage:shelf': T([1, 3], 0.3, [...TOOLS, ...CANNED, ['sheet', 1], ['rag', 1, 1, 3]]),

  // ------------------------------------------------------------ shops
  'grocery:shelf': T([2, 6], 0.25, [...CANNED, ...CANNED, ...DRY, ['jerky', 2], ['waterBottle', 5], ['soda', 3], ['garbageBag', 1, 2, 6], ['bleach', 1], ['battery', 1, 2, 4], ['matches', 1], ['lighter', 1], ['canopener', 1.5], ['purifyTabs', 0.5, 5, 10], ['seedCarrot', 0.3, 3, 8], ['seedCabbage', 0.3, 3, 8]]),
  'grocery:cooler': T([1, 5], 0.2, [['milk', 3], ['juice', 3], ['soda', 4], ['beer', 3], ['cheese', 2], ['waterBottle', 3], ['steak', 2], ['chicken', 2], ['apple', 1], ['tomato', 1]]),
  'grocery:register': T([0, 2], 0.4, [['cigarettes', 3], ['lighter', 2], ['chocolate', 3], ['battery', 2, 1, 2], ['granola', 2]]),
  'grocery:crate': T([2, 5], 0.2, [...CANNED, ['waterBottle', 4], ['garbageBag', 1, 5, 10], ['rice', 2], ['pasta', 2]]),
  'pharmacy:shelf': T([1, 5], 0.2, [...MEDS, ...MEDS, ['purifyTabs', 2, 5, 10], ['splint', 1], ['chocolate', 1], ['granola', 1], ['soda', 1], ['waterBottle', 1], ['battery', 1, 2, 4], ['comics', 1]]),
  'pharmacy:medcab': T([2, 5], 0.05, [['antibiotics', 4], ['painkillers', 4], ['betablockers', 3], ['suture', 3], ['disinfectant', 3], ['bandage', 4, 2, 5], ['splint', 2]]),
  'pharmacy:register': T([0, 2], 0.4, [['cigarettes', 2], ['chocolate', 2], ['painkillers', 1]]),
  'hardware:shelf': T([1, 5], 0.2, [...TOOLS, ['nails', 5, 40, 150], ['bucket', 2], ['seedCarrot', 1, 3, 8], ['seedPotato', 1, 3, 6], ['seedTomato', 1, 3, 8], ['seedCabbage', 1, 3, 8], ['rainbarrelItem', 0.5], ['generatorItem', 0.3], ['bookCarp1', 0.6], ['bookCarp2', 0.3], ['bookElec1', 0.5], ['bookFarm1', 0.5], ['workPants', 1], ['boots', 1], ['woodcrateItem', 0.4]]),
  'hardware:crate': T([2, 5], 0.1, [['plank', 5, 2, 6], ['nails', 3, 40, 100], ['log', 1, 1, 2], ['scrap', 1, 1, 4]]),
  'hardware:register': T([0, 2], 0.4, [['lighter', 2], ['battery', 2, 1, 4], ['ducttape', 1]]),
  'gasstore:shelf': T([1, 4], 0.25, [['crossword', 1.5], ['cards', 1], ['chips', 4], ['chocolate', 4], ['jerky', 3], ['granola', 3], ['soda', 4], ['waterBottle', 3], ['crackers', 2], ['map', 1.5], ['lighter', 2], ['cigarettes', 2], ['battery', 2, 1, 4], ['flashlight', 1], ['gasCan', 1.2], ['ducttape', 1], ['magHotwire', 0.6], ['engineParts', 0.3], ['canopener', 0.5]]),
  'gasstore:cooler': T([1, 4], 0.2, [['soda', 5], ['beer', 3], ['waterBottle', 4], ['juice', 2], ['milk', 1]]),
  'gasstore:register': T([0, 2], 0.3, [['cigarettes', 3], ['lighter', 2], ['map', 1], ['chocolate', 2]]),
  'diner:barcounter': T([1, 3], 0.3, [['soda', 4], ['beer', 2], ['whiskey', 1], ['juice', 2]]),
  'dinerKitchen:counter': T([1, 4], 0.2, [...CANNED, ['rice', 2], ['pasta', 2], ['bread', 2], ['knife', 2], ['pot', 2], ['pan', 2], ['bleach', 1], ['matches', 1], ['rag', 1, 1, 3]]),
  'dinerKitchen:fridge': T([2, 5], 0.1, [['steak', 3], ['chicken', 3], ['cheese', 2], ['milk', 2], ['tomato', 2], ['cabbage', 1], ['carrot', 1], ['potato', 2]]),
  'dinerKitchen:freezer': T([2, 4], 0.1, [['steak', 3], ['chicken', 3]]),
  'dinerKitchen:oven': T([0, 1], 0.5, [['pot', 2], ['pan', 2]]),
  'bar:barcounter': T([1, 4], 0.2, [['whiskey', 4], ['beer', 5], ['emptyBottle', 3], ['cigarettes', 2], ['lighter', 2], ['bat', 0.4], ['shotgun', 0.06], ['shells', 0.1, 3, 8]]),
  'bar:crate': T([1, 4], 0.2, [['beer', 5], ['whiskey', 2], ['emptyBottle', 3], ['chips', 2]]),

  // ------------------------------------------------------------ services
  'lockers:locker': T([1, 3], 0.2, [['baton', 3], ['vest', 1.2], ['helmet', 1], ['boots', 2], ['gloves', 2], ['flashlight', 2], ['battery', 2, 1, 3], ['pistol', 0.6], ['ammo9', 1, 8, 20], ['shotgun', 0.15], ['shells', 0.4, 4, 10], ['granola', 1], ['leatherJacket', 0.5]]),
  'armory:locker': T([2, 4], 0.02, [['pistol', 4], ['shotgun', 2], ['rifle', 1.5], ['ammo9', 5, 15, 40], ['shells', 4, 8, 20], ['ammo308', 2, 5, 15], ['vest', 2], ['helmet', 2]]),
  'armory:crate': T([2, 4], 0.02, [['ammo9', 5, 15, 40], ['shells', 4, 8, 20], ['ammo308', 2, 5, 15], ['vest', 1], ['helmet', 1]]),
  'policeOffice:desk': T([0, 3], 0.25, [['ammo9', 1, 3, 10], ['map', 1.5], ['flashlight', 2], ['battery', 2, 1, 3], ['painkillers', 1], ['baton', 0.5], ['comics', 1], ['radio', 1]]),
  'policeOffice:filing': T([0, 2], 0.4, [['newspaper', 3], ['magHotwire', 0.5], ['map', 1]]),
  'policeLobby:cashbox': T([0, 2], 0.5, [['map', 2], ['flashlight', 1], ['battery', 1, 1, 3]]),
  'exam:medcab': T([1, 4], 0.1, [...MEDS, ['splint', 2], ['suture', 2], ['antibiotics', 1.5]]),
  'clinicPharmacy:medcab': T([2, 5], 0.02, [['antibiotics', 4], ['painkillers', 4], ['betablockers', 3], ['suture', 3], ['disinfectant', 4], ['bandage', 4, 2, 5], ['splint', 2], ['wipes', 2, 4, 10]]),
  'clinicPharmacy:shelf': T([2, 5], 0.05, [...MEDS, ...MEDS, ['splint', 2]]),
  'waiting:cashbox': T([0, 2], 0.4, [['painkillers', 1], ['comics', 2], ['map', 0.5]]),
  'office:filing': T([0, 2], 0.4, [['newspaper', 2], ['magGenerator', 0.3]]),
  'breakroom:fridge': T([0, 3], 0.3, [['soda', 3], ['juice', 2], ['cheese', 1], ['bread', 1], ['apple', 1]]),
  'breakroom:counter': T([0, 2], 0.4, [['crackers', 2], ['chips', 2], ['granola', 2], ['knife', 1], ['canopener', 1]]),

  // ------------------------------------------------------------ industrial / rural
  'warehouse:rack': T([1, 4], 0.25, [...CANNED, ['waterBottle', 3], ['garbageBag', 2, 5, 10], ['bleach', 1], ['ducttape', 2], ['nails', 2, 50, 150], ['plank', 2, 2, 6], ['gloves', 2], ['boots', 1], ['hikingBag', 1], ['engineParts', 1.5], ['carBattery', 0.8], ['tire', 1], ['scrap', 2, 1, 4], ['generatorItem', 0.3], ['gasCan', 1], ['twine', 1], ['extinguisher', 1], ['crowbar', 0.6], ['workPants', 1]]),
  'warehouse:crate': T([1, 4], 0.2, [['plank', 3, 2, 6], ['scrap', 2, 1, 4], ['nails', 2, 30, 90], ...CANNED]),
  'factory:rack': T([1, 3], 0.3, [['scrap', 3, 1, 4], ['engineParts', 2], ['wrench', 1], ['pipe', 2], ['gloves', 2], ['extinguisher', 1], ['ducttape', 1], ['carBattery', 0.6]]),
  'factory:locker': T([0, 2], 0.3, [['gloves', 2], ['workPants', 2], ['boots', 2], ['hoodie', 1], ['granola', 1], ['cigarettes', 1], ['lighter', 1]]),
  'barn:hay': T([0, 3], 0.35, [['seedCarrot', 2, 3, 8], ['seedPotato', 2, 3, 6], ['seedTomato', 1, 3, 8], ['seedCabbage', 1, 3, 8], ['twine', 2], ['sheet', 1], ['bucket', 1], ['potato', 2, 1, 3], ['carrot', 2, 1, 3], ['rifle', 0.15], ['ammo308', 0.3, 4, 10]]),
  'barn:workbench': T([1, 4], 0.1, [...TOOLS, ['shovel', 3], ['axe', 1], ['bucket', 2], ['seedPotato', 1, 3, 6]]),
  'barn:crate': T([1, 3], 0.2, [['potato', 3, 2, 5], ['carrot', 3, 2, 5], ['cabbage', 2], ['log', 1, 1, 2], ['plank', 2, 1, 4]]),
  'cabin:wardrobe': T([1, 4], 0.05, [['fishingRod', 2], ['worms', 0.8, 4, 10], ['rifle', 1.2], ['ammo308', 2, 5, 15], ['winterCoat', 2], ['boots', 2], ['hikingBag', 1.2], ['huntknife', 2], ['axe', 1], ['sweater', 2], ['beanie', 2], ['scarf', 1], ['bookForage1', 1], ['matches', 2], ['flashlight', 1]]),
  'cabin:counter': T([1, 3], 0.2, [...CANNED, ['jerky', 3], ['matches', 2], ['lighter', 1], ['pot', 2], ['whiskey', 1], ['purifyTabs', 1, 5, 10], ['canopener', 1.5]]),
  'motelRoom:nightstand': T([0, 2], 0.35, [['cards', 1], ['crossword', 1], ['comics', 2], ['cigarettes', 2], ['painkillers', 1], ['whiskey', 1], ['pistol', 0.02], ['ammo9', 0.1, 3, 8], ['alarmClock', 1], ['map', 0.5]]),
  'motelRoom:dresser': T([0, 2], 0.35, [['sheet', 3], ['tshirt', 2], ['duffel', 0.8], ['jeans', 1], ['hoodie', 1]]),
  // ---- gun store: the reason you make the run
  'gunstore:gunshop:gunrack': T([1, 3], 0.1, [['rifle', 3], ['shotgun', 3], ['ammo308', 1.5, 5, 15], ['shells', 1.5, 5, 12]]),
  'gunstore:gunshop:guncase': T([1, 2], 0.2, [['pistol', 3], ['revolver', 2.5], ['ammo9', 2, 8, 20], ['ammo38', 2, 6, 18], ['huntknife', 2], ['flashlight', 0.8]]),
  'gunstore:gunshop:register': T([0, 2], 0.4, [['ammo9', 1, 5, 12], ['ammo38', 1, 5, 12], ['cigarettes', 1], ['lighter', 1]]),
  'gunstore:storage:shelf': T([2, 4], 0.05, [['ammo9', 3, 15, 40], ['ammo38', 2, 10, 30], ['shells', 3, 8, 20], ['ammo308', 2, 8, 20], ['vest', 0.5]]),
  'gunstore:storage:crate': T([1, 3], 0.1, [['ammo9', 2, 15, 40], ['shells', 2, 8, 20], ['ammo308', 2, 8, 20], ['huntknife', 1]]),
  'gunstore:office:desk': T([0, 2], 0.3, [['ammo9', 1, 5, 12], ['painkillers', 1], ['cigarettes', 1], ['crossword', 0.6], ['revolver', 0.3]]),
  // ---- sporting goods
  'sporting:sportshop:shelf': T([1, 4], 0.15, [['bat', 3], ['golfclub', 2], ['fishingRod', 2], ['worms', 1, 5, 15], ['waterBottle', 3], ['granola', 3], ['jerky', 2], ['flashlight', 1.5], ['battery', 2, 2, 4], ['hatchet', 1], ['machete', 0.6], ['twine', 1.5], ['matches', 1.5], ['cards', 1], ['purifyTabs', 1, 5, 10]]),
  'sporting:sportshop:rack': T([1, 3], 0.15, [['hikingBag', 2], ['duffel', 1.5], ['sleepbagItem', 1.5], ['raincoat', 2], ['winterCoat', 1.5], ['boots', 2], ['sneakers', 2], ['beanie', 1.5], ['gloves', 1.5], ['fishingRod', 1]]),
  'sporting:sportshop:guncase': T([0, 2], 0.3, [['huntknife', 3], ['ammo308', 1.5, 5, 10], ['shells', 1.5, 5, 10], ['rifle', 0.35], ['shotgun', 0.25]]),
  'sporting:storage:shelf': T([1, 3], 0.2, [['waterBottle', 3], ['granola', 2], ['bat', 1], ['sleepbagItem', 1], ['hikingBag', 0.8], ['fishingRod', 1]]),
  'sporting:storage:crate': T([1, 3], 0.2, [['bat', 2], ['golfclub', 1], ['boots', 1], ['jerky', 1], ['matches', 1]]),
  // ---- fire station
  'firestation:gearRoom:locker': T([1, 3], 0.1, [['fireJacket', 3], ['axe', 2.5], ['extinguisher', 2], ['crowbar', 1.5], ['helmet', 1], ['boots', 2], ['gloves', 2], ['flashlight', 1.5]]),
  'firestation:gearRoom:shelf': T([1, 3], 0.15, [['bandage', 3, 1, 3], ['disinfectant', 1.5], ['extinguisher', 1.5], ['flashlight', 1.5], ['battery', 2, 2, 4], ['twine', 1], ['splint', 1]]),
  'firestation:fireBay:toolchest': T([1, 3], 0.1, TOOLS),
  'firestation:fireBay:shelf': T([1, 3], 0.2, [['extinguisher', 2], ['gasCan', 1.5], ['axe', 1], ['crowbar', 1], ['sledge', 0.4]]),
  'firestation:fireBay:workbench': T([1, 3], 0.15, TOOLS),
  'firestation:dorm:locker': T([0, 2], 0.3, [['tshirt', 2], ['hoodie', 1.5], ['sneakers', 1], ['comics', 1.5], ['cards', 1.5], ['cigarettes', 1], ['jerky', 1], ['chocolate', 1]]),
  'firestation:office:desk': T([0, 2], 0.3, [['map', 1.5], ['radio', 1], ['flashlight', 1], ['battery', 1, 1, 3], ['painkillers', 1], ['crossword', 1]]),
  // ---- school
  'school:hallway:locker': T([0, 2], 0.3, [['schoolBag', 3], ['sneakers', 1.5], ['hoodie', 1.5], ['comics', 3], ['cards', 1.2], ['chips', 2], ['soda', 2], ['chocolate', 1.5], ['crossword', 0.6], ['bat', 0.4], ['painkillers', 0.4]]),
  'school:classroom:desk': T([0, 1], 0.55, [['comics', 1], ['crossword', 0.6], ['newspaper', 1], ['chocolate', 1], ['granola', 1], ['map', 0.2], ['battery', 0.5]]),
  'school:classroom:bookshelf': T([1, 3], 0.2, BOOKS),
  'school:cafeteria:fridge': T([1, 4], 0.1, [['milk', 4], ['juice', 4], ['cheese', 2], ['apple', 3], ['orange', 2], ['carrot', 1]]),
  'school:cafeteria:freezer': T([1, 3], 0.2, [['chicken', 2], ['steak', 1]]),
  'school:cafeteria:counter': T([1, 3], 0.15, [...CANNED, ['bread', 2], ['crackers', 2], ['cereal', 2], ['pbutter', 1.5], ['canopener', 1], ['knife', 1], ['pot', 1], ['pan', 0.6]]),
  'school:nurse:medcab': T([1, 4], 0.1, [['bandage', 4, 1, 3], ['painkillers', 3], ['disinfectant', 2], ['wipes', 3, 2, 6], ['tweezers', 1], ['splint', 1]]),
  'school:nurse:desk': T([0, 2], 0.3, [['painkillers', 1], ['bandage', 1], ['crossword', 0.5]]),
  'school:office:desk': T([0, 2], 0.3, [['map', 1.2], ['radio', 0.8], ['painkillers', 1], ['chocolate', 1], ['newspaper', 1]]),
  // ---- hospital
  'hospital:ward:medcab': T([1, 4], 0.1, [['bandage', 5, 1, 4], ['painkillers', 3], ['disinfectant', 3], ['wipes', 3, 2, 6], ['suture', 1.5], ['antibiotics', 1], ['splint', 1], ['tweezers', 1]]),
  'hospital:ward:nightstand': T([0, 2], 0.4, [['painkillers', 1], ['comics', 1], ['crossword', 1], ['chocolate', 1], ['watch', 0.5], ['cards', 0.6]]),
  'hospital:surgery:medcab': T([2, 4], 0.05, [['suture', 4], ['disinfectant', 3], ['bandage', 4, 2, 5], ['tweezers', 2], ['antibiotics', 1.5], ['painkillers', 2], ['splint', 2]]),
  'hospital:surgery:counter': T([1, 3], 0.15, [['bandage', 3, 1, 3], ['gloves', 1], ['disinfectant', 2], ['wipes', 2, 2, 6]]),
  'hospital:hospitalPharmacy:medcab': T([2, 5], 0.02, [['antibiotics', 4], ['painkillers', 4], ['betablockers', 3], ['purifyTabs', 1, 5, 10], ['disinfectant', 2], ['bandage', 2, 2, 5], ['suture', 1.5]]),
  'hospital:hospitalPharmacy:shelf': T([1, 4], 0.1, [['antibiotics', 2], ['painkillers', 3], ['bandage', 3, 2, 5], ['wipes', 2, 4, 10], ['splint', 1.5]]),
  'hospital:storage:shelf': T([1, 4], 0.1, [['bandage', 3, 2, 5], ['disinfectant', 2], ['wipes', 2, 2, 8], ['sheet', 3], ['rag', 2, 2, 4], ['battery', 1, 2, 4], ['flashlight', 1], ['waterBottle', 2], ['splint', 1]]),
  'hospital:reception:register': T([0, 2], 0.4, [['painkillers', 1], ['chocolate', 1], ['crossword', 0.6], ['map', 0.5]]),
  'hospital:reception:filing': T([0, 2], 0.5, [['newspaper', 2], ['map', 0.5]]),
  // ---- Camp Harlan
  'military:barracks:locker': T([1, 3], 0.1, [['militaryPack', 1], ['vest', 0.6], ['helmet', 0.8], ['mre', 3, 1, 2], ['waterBottle', 2], ['bandage', 2, 1, 2], ['cigarettes', 1.5], ['cards', 1.5], ['huntknife', 1], ['boots', 1.5], ['ammo9', 0.8, 5, 12], ['ammo308', 0.8, 5, 10], ['pistol', 0.2]]),
  'military:messHall:fridge': T([1, 3], 0.2, [['milk', 2], ['cheese', 2], ['juice', 2], ['apple', 1]]),
  'military:messHall:freezer': T([1, 3], 0.2, [['steak', 2], ['chicken', 2]]),
  'military:messHall:counter': T([2, 4], 0.05, [['mre', 5, 1, 3], ...CANNED, ['waterBottle', 3], ['canopener', 1], ['knife', 1], ['pot', 1]]),
  'military:command:desk': T([1, 2], 0.2, [['map', 2], ['radio', 1.5], ['flashlight', 1], ['battery', 1, 2, 4], ['ammo9', 1, 5, 12], ['pistol', 0.3]]),
  'military:command:filing': T([0, 2], 0.4, [['map', 1], ['newspaper', 1], ['magHotwire', 0.6]]),
  'military:command:locker': T([1, 2], 0.2, [['vest', 1], ['helmet', 1], ['militaryPack', 0.8], ['mre', 1, 1, 2]]),
  'military:armory:gunrack': T([2, 4], 0.02, [['rifle', 4], ['shotgun', 1.5], ['pistol', 2], ['ammo308', 3, 10, 30], ['ammo9', 2, 15, 40]]),
  'military:yard:crate': T([1, 3], 0.1, [['mre', 4, 1, 3], ['waterBottle', 3], ['bandage', 2, 2, 4], ['ammo308', 1, 5, 15], ['battery', 1, 2, 4], ['purifyTabs', 1, 5, 10], ['militaryPack', 0.4]]),
  'checkpoint:crate': T([2, 5], 0.02, [['mre', 5, 1, 3], ['waterBottle', 4], ['militaryPack', 1], ['vest', 1], ['helmet', 1], ['rifle', 0.6], ['ammo308', 1.5, 5, 15], ['bandage', 2, 2, 5], ['antibiotics', 1], ['flashlight', 1], ['battery', 2, 2, 4], ['map', 1], ['purifyTabs', 1, 5, 10]]),
  'church:bookshelf': T([0, 2], 0.4, [['newspaper', 2], ['comics', 1], ['bookFarm1', 0.5]]),

  // ------------------------------------------------------------ generic fallbacks
  fridge: T([0, 3], 0.3, [['soda', 3], ['juice', 2], ['milk', 2], ['cheese', 1], ['beer', 2]]),
  freezer: T([0, 2], 0.4, [['steak', 2], ['chicken', 2]]),
  counter: T([0, 2], 0.45, [...CANNED, ...DRY, ['knife', 1], ['canopener', 1], ['waterBottle', 1]]),
  oven: T([0, 1], 0.7, [['pot', 1], ['pan', 1]]),
  wardrobe: T([1, 3], 0.2, CLOTHES),
  dresser: T([0, 2], 0.3, CLOTHES),
  nightstand: T([0, 1], 0.5, [['comics', 1], ['painkillers', 1], ['battery', 1], ['watch', 1]]),
  medicine: T([0, 2], 0.4, MEDS),
  shelf: T([0, 3], 0.4, [...CANNED, ...TOOLS]),
  rack: T([0, 3], 0.4, [...TOOLS, ['scrap', 2]]),
  bookshelf: T([0, 2], 0.3, BOOKS),
  desk: T([0, 2], 0.4, [['battery', 1], ['comics', 1], ['newspaper', 1], ['painkillers', 0.5], ['flashlight', 0.5]]),
  filing: T([0, 1], 0.6, [['newspaper', 1]]),
  crate: T([0, 3], 0.4, [['plank', 2, 1, 3], ['scrap', 1], ['nails', 1, 10, 30], ...CANNED]),
  locker: T([0, 2], 0.4, [['tshirt', 1], ['hoodie', 1], ['sneakers', 1], ['granola', 1], ['cigarettes', 1]]),
  toolchest: T([1, 3], 0.2, TOOLS),
  workbench: T([1, 3], 0.2, TOOLS),
  register: T([0, 1], 0.5, [['cigarettes', 1], ['lighter', 1], ['chocolate', 1]]),
  cashbox: T([0, 1], 0.6, [['map', 1], ['battery', 1]]),
  cooler: T([0, 3], 0.3, [['soda', 3], ['waterBottle', 2], ['beer', 1]]),
  trash: T([0, 2], 0.4, [['emptyCan', 3], ['emptyBottle', 2], ['newspaper', 2], ['rag', 1], ['bread', 1], ['garbageBag', 1]]),
  dumpster: T([0, 4], 0.25, [['emptyCan', 3], ['emptyBottle', 3], ['newspaper', 2], ['rag', 2, 1, 3], ['scrap', 1], ['plank', 1], ['sheet', 0.5], ['bread', 1], ['garbageBag', 1, 1, 3]]),
  trunk: T([0, 3], 0.3, [['jack', 2], ['lugwrench', 2], ['tire', 1], ['gasCan', 1.5], ['duffel', 0.6], ['bat', 0.5], ['flashlight', 1], ['waterBottle', 1], ['plasticBag', 1], ['engineParts', 0.3], ['crowbar', 0.3], ['schoolBag', 0.4], ['golfclub', 0.4]]),
  glovebox: T([0, 2], 0.35, [['map', 3], ['lighter', 1], ['flashlight', 1], ['cigarettes', 1], ['battery', 1, 1, 2], ['painkillers', 1], ['pistol', 0.08], ['wipes', 0.5, 2, 4]]),
  mailbox: T([0, 1], 0.5, [['newspaper', 3], ['comics', 1], ['magGenerator', 0.3], ['magHotwire', 0.2], ['magTraps', 0.2]]),
  washer: T([0, 2], 0.5, [['tshirt', 2], ['jeans', 1], ['sheet', 2]]),
  barcounter: T([0, 3], 0.3, [['beer', 3], ['whiskey', 1], ['soda', 2]]),
  medcab: T([1, 3], 0.2, MEDS),
  hay: T([0, 1], 0.7, [['twine', 1], ['seedCarrot', 1, 2, 4]]),
  woodcrate: T([0, 0], 1, []),
  stove: T([0, 0], 1, []),
  barrel: T([0, 0], 1, []),
  floor: T([0, 0], 1, []),
  corpse: T([0, 1], 0.65, [['cigarettes', 2], ['lighter', 2], ['watch', 1.5], ['bandage', 1], ['painkillers', 1], ['knife', 0.6], ['waterBottle', 1], ['chocolate', 1.5], ['granola', 1], ['wipes', 0.5, 1, 3], ['comics', 0.5], ['map', 0.3]]),
};

export interface LootContext {
  bldKind: string;
  roomType: string;
  containerKind: string;
  /** Effective hours fresh food has been ageing (refrigeration slows it). */
  foodAge: number;
  abundance: number;
}

function findTable(ctx: LootContext): Table | null {
  return (
    TABLES[`${ctx.bldKind}:${ctx.roomType}:${ctx.containerKind}`] ??
    TABLES[`${ctx.roomType}:${ctx.containerKind}`] ??
    TABLES[`${ctx.bldKind}:${ctx.containerKind}`] ??
    TABLES[ctx.containerKind] ??
    null
  );
}

export function generateLoot(src: UidSource, rng: Rng, ctx: LootContext): Item[] {
  const table = findTable(ctx);
  if (!table) return [];
  const out: Item[] = [];
  const emptyChance = Math.min(0.95, table.empty / Math.max(0.2, ctx.abundance));
  if (rng.chance(emptyChance)) return out;
  let rolls = rng.int(table.rolls[0], table.rolls[1]);
  rolls = Math.max(0, Math.round(rolls * (0.6 + 0.4 * ctx.abundance)));
  const valid = table.items.filter((e) => e[1] > 0);
  if (!valid.length) return out;
  for (let r = 0; r < rolls; r++) {
    const e = rng.weighted(valid.map((v) => [v, v[1]] as const));
    const [id, , qmin, qmax] = e;
    const d = def(id);
    const qty = qmin !== undefined ? rng.int(qmin, qmax ?? qmin) : 1;
    const stackable = d.stack !== undefined;
    const it = makeItem(src, id, { qty: stackable ? qty : 1 });
    decorate(it, rng, ctx);
    // Stackables merge; non-stackables with qty>1 become several items.
    if (stackable) {
      const ex = out.find((o) => o.id === id && !o.contents);
      if (ex) ex.qty = Math.min(d.stack!, ex.qty + it.qty);
      else out.push(it);
    } else {
      out.push(it);
      for (let k = 1; k < qty; k++) {
        const extra = makeItem(src, id);
        decorate(extra, rng, ctx);
        out.push(extra);
      }
    }
  }
  return out;
}

function decorate(it: Item, rng: Rng, ctx: LootContext): void {
  const d = def(it.id);
  if (d.weapon && d.cat === 'weapon') it.cond = rng.range(0.45, 1);
  if (d.firearm) {
    it.cond = rng.range(0.6, 1);
    it.ammo = rng.chance(0.4) ? rng.int(0, d.firearm.mag) : 0;
  }
  if (d.food?.spoil) it.age = ctx.foodAge + rng.range(0, 30);
  if (d.id === 'waterBottle' || d.id === 'jug') {
    const storeBought = ctx.roomType === 'grocery' || ctx.roomType === 'gasstore' || ctx.containerKind === 'cooler' || ctx.bldKind === 'checkpoint' || ctx.bldKind === 'warehouse';
    if (storeBought || rng.chance(0.4)) {
      it.fill = d.liquid!.cap * (storeBought ? 1 : rng.range(0.3, 1));
      it.liquid = 'water';
    }
  }
  if (d.id === 'gasCan' && rng.chance(0.35)) {
    it.fill = rng.range(1, 6);
    it.liquid = 'fuel';
  }
  if (d.id === 'whiskey') {
    it.fill = rng.range(0.2, 0.7);
    it.liquid = 'alcohol';
  }
  if (d.light) it.charge = rng.range(0.1, 1);
  if (d.id === 'lighter' || d.id === 'matches' || d.uses) it.usesLeft = Math.max(1, Math.round((d.uses ?? 1) * rng.range(0.3, 1)));
  if (d.id === 'carBattery') it.charge = rng.range(0.2, 0.9);
}
