# Basement

## [▶ PLAY BASEMENT NOW](https://fridgepassword.github.io/basement/)

**https://fridgepassword.github.io/basement/** runs in your browser on desktop or phone. There's nothing to install.

A top-down horror game. The power is out and the fuse box is in the basement. Find the fuses, get the stairs working, and get out. Something is down there with you. Maybe more than one thing.

Everything (the art, the maze, every sound and the jump scares) is generated in code. There are no image or audio files. **Wear headphones.** The jump scares are loud and they flash, and you can switch them off in Settings.

## The things in the dark
Each one follows a rule. Learn the rules and you can get past them.

| | Rule |
|---|---|
| **She** | Freezes while light is on her, from your flashlight or a ceiling bulb. Look away and she comes closer. |
| **The crawler** | Hunts by sound. When you hear clicking, stand still. Running is loud, so it hears you from much farther away. |
| **The moth** | Follows your flashlight, even through walls. Switch your light off and it loses you. Going dark also lets *her* move. |

## Nights
| Night | Fuses | What's down there |
|---|---|---|
| 1 | 3 | She arrives, then the crawler, then another of her |
| 2 | 3 | Bigger basement. The moth shows up |
| 3 | 4 | All three of them, plus a second of her |
| 4 | 4 | Bigger and faster |
| 5 | 5 | The biggest basement, five things hunting you |
| 6+ | 5 | Endless. Each night is a little faster |

Every basement is a new random maze. Your best time for each night is saved, and you can replay any night you've reached.

## Controls
| | Keyboard | Touch |
|---|---|---|
| Walk | `W` `A` `S` `D` or arrow keys | Drag anywhere |
| Run | hold `Shift` | Drag farther, past the outer ring |
| Flashlight on/off | `F` or `Space` | **Light** button |
| Map | hold `M` or `Tab` | **Map** button |
| Pause | `Esc` or `P` | ❚❚ button |

Your flashlight points where you walk. It drains its battery only while it's on, so grab the spare batteries you find. Running costs breath, and if you run out you have to walk until you get it back.

The map only shows the parts of the basement you've actually seen.

## Extras
- **Notes.** Twelve handwritten notes from the family who lived here are scattered through the basement. The ones you find are saved in your **Journal**.
- **Settings.** Volume, jump scares on/off, and screen shake/glitch effects on/off. It also respects your system's reduced-motion setting.
- Progress, best times and notes are saved in your browser.

## Running it locally
Download or clone the repo and open `index.html` in any modern browser. The game is three files (`index.html`, `style.css`, `game.js`) with no build step.

For testing, open the page with `?debug` on the end of the address. That adds a `basement` object in the browser console with helpers such as `basement.state`, `basement.tick(seconds)` and `basement.revealMap()`.
