/** Emoji icons matching Milltown archetypes (renderer + chat dock). */
const ARCHETYPE_EMOJI: Record<string, string> = {
  gatekeeper: '💂',
  baker: '👩‍🍳',
  miller: '🧑‍🌾',
  apprentice: '🧑‍🔧',
  innkeeper: '👩‍🦰',
  farmhand: '👨‍🌾',
  priest: '👴',
  smith: '🧑‍🏭',
  beggar: '🧓',
  cat: '🐈',
  player: '🧑‍🦱',
  coin: '🪙',
  bread: '🍞',
  lantern: '🏮',
  noticeboard: '📋',
  mill: '🏭',
};

export function archetypeEmoji(archetype: string, kind?: string): string {
  const direct = ARCHETYPE_EMOJI[archetype];
  if (direct) return direct;
  if (kind === 'item') return '📦';
  if (kind === 'npc') return '🧑';
  if (kind === 'creature') return '🐾';
  if (kind === 'structure') return '🏛️';
  if (kind === 'player') return '🧑‍🦱';
  return '•';
}

export function entityLabel(name: string, archetype: string, kind?: string): string {
  return `${archetypeEmoji(archetype, kind)} ${name}`;
}
