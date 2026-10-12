import { describe, expect, it } from "vitest";
import { swipeDirection, type SwipeDirection, type SwipePoint } from "./swipe.ts";

const WIDTH = 360;
const at = (x: number, y: number): SwipePoint => ({ x, y });

describe("swipeDirection", () => {
  it.each<[string, SwipePoint, SwipePoint, SwipeDirection | null]>([
    ["a flat swipe toward the left", at(300, 400), at(100, 400), "left"],
    ["a flat swipe toward the right", at(60, 400), at(260, 400), "right"],
    ["exactly far enough", at(200, 400), at(136, 400), "left"],
    ["a pixel short", at(200, 400), at(137, 400), null],
    ["a tap", at(200, 400), at(200, 400), null],
    ["a tap that slipped a little", at(200, 400), at(212, 395), null],
    ["a scroll down the page", at(200, 500), at(205, 200), null],
    ["a scroll that drifted sideways", at(200, 500), at(280, 200), null],
    ["a slight slope is still a swipe", at(300, 400), at(100, 460), "left"],
    ["just flat enough: 100 across, 49 down", at(250, 400), at(150, 449), "left"],
    ["just too steep: 100 across, 50 down", at(250, 400), at(150, 450), null],
    ["a diagonal upward is too steep as well", at(100, 500), at(200, 420), null],
    ["starting at the left edge, where the back gesture lives", at(10, 400), at(250, 400), null],
    ["starting at the right edge", at(350, 400), at(100, 400), null],
    ["starting just inside the left guard", at(24, 400), at(250, 400), "right"],
    ["starting just inside the right guard", at(336, 400), at(100, 400), "left"],
    ["ending at the edge is fine", at(200, 400), at(2, 400), "left"],
  ])("%s", (_name, start, end, expected) => {
    expect(swipeDirection(start, end, WIDTH)).toBe(expected);
  });

  it("measures the edges against the width it is given", () => {
    expect(swipeDirection(at(350, 400), at(100, 400), 1280)).toBe("left");
    expect(swipeDirection(at(1270, 400), at(900, 400), 1280)).toBeNull();
  });
});
