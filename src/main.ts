import { Game } from './game';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const game = new Game(canvas);
game.start();

// expose for quick debugging in devtools
(window as unknown as { game: Game }).game = game;
