import { randomInt } from "node:crypto";

// Join codes look like ABCD-1234 (the schema's join_code_shape check). No I or
// O, so a code read aloud at the check-in desk can't be misheard as 1 or 0.
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export function newJoinCode(taken: Set<string>): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) code += LETTERS[randomInt(LETTERS.length)];
    code += "-";
    for (let i = 0; i < 4; i++) code += randomInt(10);
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
}
