import diagram from "./assets/diagram.png";
import crystalBall from "./assets/crystal-ball.png";
import heart from "./assets/heart.png";

const banner = new URL("./assets/diagram.png", import.meta.url);

export function App() {
  return (
    <main>
      <img src="/hero.png" alt="An arcade stick" />
      <img src={diagram} alt="Parts of a flower" />
      <img src={crystalBall} alt="" />
      <img src={heart} alt="" />
      <figure style={{ backgroundImage: `url(${banner})` }} />
      <img src="/photo.jpg" alt="A red door" />
      <img src="/missing.png" alt="" />
    </main>
  );
}
