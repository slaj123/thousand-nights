// Backup pool: verified replacements that verify_links.mjs --fix swaps in when
// a link in days_*.json or light_pool.json dies. Essays carry their field tag
// so a dead essay is replaced by one from the same field.
export const idPrefix = 'bk';

const P = (slug, title, tag, min = 2) => ({ kind: 'poem', src: 'pf', slug, title, tag, min });
const A = (slug, title, tag) => ({ kind: 'story', src: 'al', slug, title, tag });
const U = (url, title, author, tag, min) => ({ src: 'url', url, title, author, tag, min });
const MON = 'https://monadnock.net/';
const Q = 'https://www.quantamagazine.org/';
const JD = 'https://daily.jstor.org/';

export const poems = [
  P('robert-frost', 'After Apple-Picking', 'Modern', 3),
  P('robert-frost', 'The Tuft of Flowers', 'Modern', 3),
  P('william-shakespeare', 'Sonnet 60', 'Renaissance', 1),
  P('alexander-pope', 'Eloisa to Abelard', '18th century', 15),
  P('john-donne', 'The Sun Rising', '17th century'),
  P('william-butler-yeats', 'Sailing to Byzantium', 'Modern'),
  P('john-keats', 'To Autumn', 'Romantic'),
  P('walt-whitman', 'A Noiseless Patient Spider', '19th-century American', 1),
  P('emily-dickinson', 'Tell all the truth but tell it slant', '19th-century American', 1),
  P('langston-hughes', 'Mother to Son', 'Modern', 1),
  P('sappho', 'Fragment 1', 'Ancient'),
  P('w-h-auden', 'Musée des Beaux Arts', 'Modern'),
  P('thomas-hardy', 'The Convergence of the Twain', 'Victorian'),
];

export const stories = [
  A('anton-chekhov', 'A Chameleon', 'comedy'),
  A('o-henry', 'The Romance of a Busy Broker', 'comedy'),
  A('edgar-allan-poe', 'The Oval Portrait', 'horror'),
  A('saki', 'Tobermory', 'comedy'),
  A('ambrose-bierce', 'A Horseman in the Sky', 'war'),
  A('mark-twain', 'Cannibalism In The Cars', 'satire'),
  A('oscar-wilde', 'The Model Millionaire', 'comedy'),
  A('ernest-hemingway', 'The End of Something', 'literary'),
  A('franz-kafka', 'A Country Doctor', 'literary'),
  A('kate-chopin', 'The Locket', 'war'),
  A('guy-de-maupassant', 'The Umbrella', 'comedy'),
  A('jack-london', 'The White Silence', 'adventure'),
];

export const essays = [
  U(MON + 'hume/sceptic.html', 'The Sceptic', 'David Hume', 'philosophy', 30),
  U(MON + 'emerson/circles.html', 'Circles', 'Ralph Waldo Emerson', 'philosophy', 25),
  U(Q + 'how-is-cell-death-essential-to-life-20241205/', 'How Is Cell Death Essential to Life?', '?', 'biology', 12),
  U(MON + 'burroughs/eagle.html', 'The Flight of the Eagle', 'John Burroughs', 'biology', 25),
  U(JD + 'how-the-plague-reshaped-the-world/', 'How the Plague Reshaped the World', '?', 'history', 6),
  U('https://publicdomainreview.org/essay/typing-for-love-or-money/', 'Typing for Love or Money', '?', 'history', 20),
  U(MON + 'constant/liberty.html', 'The Liberty of Ancients Compared with that of Moderns', 'Benjamin Constant', 'politics', 40),
  U('https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/reflections-on-gandhi/', 'Reflections on Gandhi', 'George Orwell', 'politics', 20),
  U(MON + 'woolf/montaigne.html', 'Montaigne', 'Virginia Woolf', 'literary criticism', 20),
  U('https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/rudyard-kipling/', 'Rudyard Kipling', 'George Orwell', 'literary criticism', 25),
  U(MON + 'hume/middle.html', 'Of the Middle Station of Life', 'David Hume', 'economics', 8),
  U(Q + 'the-man-who-stole-infinity-20260225/', 'The Man Who Stole Infinity', '?', 'physics & math', 15),
  U('https://psyche.co/ideas/jungs-archetypes-are-a-mirror-that-shows-who-and-what-we-are', 'Jung’s archetypes are a mirror that shows who and what we are', '?', 'psychology', 12),
  U(Q + 'concept-cells-help-your-brain-abstract-information-and-build-memories-20250121/', 'Concept Cells Help Your Brain Abstract Information and Build Memories', '?', 'psychology', 12),
  U(JD + 'when-landscape-painting-was-protest-art/', 'When Landscape Painting Was Protest Art', '?', 'art', 6),
  U(MON + 'santayana/human-scale.html', 'The Human Scale', 'George Santayana', 'art', 8),
  U('https://paulgraham.com/persistence.html', 'The Right Kind of Stubborn', 'Paul Graham', 'wildcard', 15),
  U(MON + 'hazlitt/future.html', 'On the Past and Future', 'William Hazlitt', 'wildcard', 25),
];
