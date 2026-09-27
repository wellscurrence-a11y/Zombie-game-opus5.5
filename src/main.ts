import './ui/styles.css';
import { Game } from './game';
import { newGame } from './sim/newgame';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? Math.floor(Math.random() * 1e9));
const s = newGame(seed, { name: 'Alex Mercer', occupation: 'unemployed', traits: [] });
if (params.get('hour')) s.time = Number(params.get('hour'));
const game = new Game(canvas, s);
(window as unknown as { game: Game }).game = game;
game.start();
