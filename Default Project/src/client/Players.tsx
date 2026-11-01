import type { Player } from '../shared/types';

function hue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function Avatar({
  player,
  size,
}: {
  player: Pick<Player, 'id' | 'name'>;
  size?: 'sm' | 'lg';
}): React.JSX.Element {
  return (
    <span
      className={size ? `avatar ${size}` : 'avatar'}
      style={{ '--hue': hue(player.id) } as React.CSSProperties}
      aria-hidden
    >
      {player.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function PlayerTags({ player, youId }: { player: Player; youId?: string }): React.JSX.Element {
  return (
    <>
      {player.id === youId && <span className="tag">you</span>}
      {player.isHost && <span className="tag host">host</span>}
      {!player.online && <span className="tag">offline</span>}
    </>
  );
}

export function PlayerName({ player, youId }: { player: Player; youId?: string }): React.JSX.Element {
  return (
    <span className="player-name">
      <Avatar player={player} />
      <span className={player.online ? '' : 'offline'}>{player.name}</span>
      <PlayerTags player={player} youId={youId} />
    </span>
  );
}
