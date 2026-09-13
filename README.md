# Mini Games Collection

Build a minimalist website containing a collection of short, addictive visual and accuracy games.

The inspiration is **Flashed.world**, especially its simple loop of showing something briefly, asking the player to recreate/remember it, and scoring based on accuracy:

[Flashed.world](https://flashed.world/?utm_source=chatgpt.com)

## Initial Games

### 1. Trace
Show the player a randomly generated path for a few seconds. Hide it and let them draw the path from memory. Score based on how closely their path matches the original.

### 2. Swap
Show several objects in fixed positions, then rapidly swap their positions. Ask the player where a specific object ended up.

### 3. Crowd
Show many moving dots with one target dot. The player must track the target while all dots move around and then identify its final position.

### 4. Perfect Circle
The player draws a circle freehand. Score how geometrically close it is to a perfect circle.

### 5. Wait
Ask the player to stop a timer at an exact target, such as 5.000 seconds. Score based on the difference from the target.

### 6. Blink
Briefly show an image or arrangement, then show a slightly modified version. The player must identify what changed.

### 7. Guess Distance
Show two points briefly, hide them, and ask the player to recreate or estimate the distance between them. Score based on accuracy.

### 8. Predict
Show an object moving for a short period, then hide the continuation. The player predicts where the object will end up. Reveal the actual result and score the prediction.

### 9. Count
Briefly show a collection of objects. The player must estimate or count how many appeared. Increase difficulty by reducing display time and increasing object count.

### 10. Center
Ask the player to click the exact center of a target, shape, or canvas. Score based on pixel-level distance from the true center.

## Design Principles

- Extremely simple UI
- No tutorials required
- Each game should be understandable within seconds
- Rounds should generally take 5 to 30 seconds
- Immediate score/reveal after every attempt
- Difficulty should increase progressively
- Make the result visually satisfying
- Optimize for desktop and mobile
- No unnecessary accounts or friction

## Core Loop

**Play → Perform → Reveal → Score → Try Again**

Eventually add:

- Daily challenges
- Personal bests
- Global leaderboards
- Shareable results
- Friend challenge links
- A combined daily score across all games

The overall feeling should be closer to a collection of polished micro-challenges than a traditional arcade or brain-training website.