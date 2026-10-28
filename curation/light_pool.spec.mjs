// Light-night pool: short poems (audio where Poetry Foundation has it),
// stories of ~5–12 minutes and essays of ~1–11, paired so poem + story +
// essay comes to about 15 minutes. All no-login.
// The app serves poem i, story i, essay i in rotation, so pools can differ in size.
export const idPrefix = 'lp';

const P = (slug, title, tag, min = 1) => ({ kind: 'poem', src: 'pf', slug, title, tag, min });
const A = (slug, title, tag) => ({ kind: 'story', src: 'al', slug, title, tag });
const U = (url, title, author, tag, min) => ({ src: 'url', url, title, author, tag, min });
const MON = 'https://monadnock.net/';
const PG = 'https://paulgraham.com/';
const FFO = 'https://flashfictiononline.com/issues/';

export const poems = [
  P('william-butler-yeats', 'When You Are Old', 'Modern'),
  P('william-carlos-williams', 'The Red Wheelbarrow', 'Modern'),
  P('emily-dickinson', 'I’m Nobody! Who are you?', '19th-century American'),
  P('emily-dickinson', 'Wild nights - Wild nights!', '19th-century American'),
  P('lord-byron', 'So We’ll Go No More a Roving', 'Romantic'),
  P('edna-st-vincent-millay', 'Dirge Without Music', 'Modern'),
  P('langston-hughes', 'Harlem', 'Modern'),
  P('langston-hughes', 'Dreams', 'Modern'),
  P('william-blake', 'The Tyger', 'Romantic'),
  P('ezra-pound', 'In a Station of the Metro', 'Modern'),
  P('carl-sandburg', 'Fog', 'Modern'),
  P('robert-herrick', 'Upon Julia’s Clothes', '17th century'),
  P('a-e-housman', 'Loveliest of trees, the cherry now', 'Victorian'),
  P('wallace-stevens', 'Anecdote of the Jar', 'Modern'),
  P('e-e-cummings', 'in Just-', 'Modern'),
  P('philip-larkin', 'Days', 'Contemporary'),
  P('billy-collins', 'Forgetfulness', 'Contemporary'),
  P('robert-burns', 'A Red, Red Rose', '18th century'),
  P('john-keats', 'When I have fears that I may cease to be', 'Romantic'),
  P('gerard-manley-hopkins', 'Spring and Fall', 'Victorian'),
  P('robert-frost', 'Fire and Ice', 'Modern'),
  P('robert-frost', 'Dust of Snow', 'Modern'),
  P('jane-hirshfield', 'I am asked a question.', 'Contemporary'),
  P('basho', 'In Kyoto', 'Ancient'),
  U('https://poetrysociety.org/poems/there-will-come-soft-rains', 'There Will Come Soft Rains', 'Sara Teasdale', 'Modern (the poem in Bradbury’s story)', 1),
];

export const stories = [
  A('ernest-hemingway', 'The Killers', 'crime'),
  A('anton-chekhov', 'Oysters', 'literary'),
  A('saki', 'Gabriel-Ernest', 'dark fantasy'),
  A('anton-chekhov', 'Sorrow', 'literary'),
  A('ambrose-bierce', 'The Man and the Snake', 'horror'),
  A('saki', 'The Strategist', 'comedy'),
  A('guy-de-maupassant', 'The Chair Mender', 'literary'),
  A('anton-chekhov', 'The Huntsman', 'literary'),
  A('sherwood-anderson', 'The Philosopher', 'literary'),
  A('anton-chekhov', 'Boots', 'comedy'),
  A('saki', 'The Unrest-Cure', 'comedy'),
  A('ernest-hemingway', 'In Another Country', 'war'),
  A('saki', 'The Storyteller', 'comedy'),
  A('ambrose-bierce', 'A Son of the Gods', 'war'),
  A('james-joyce', 'After the Race', 'literary'),
  A('anton-chekhov', 'A Slander', 'comedy'),
  A('ambrose-bierce', 'The Applicant', 'literary'),
  A('saki', 'The Mouse', 'comedy'),
  A('sherwood-anderson', 'Paper Pills', 'literary'),
  A('anton-chekhov', 'Grisha', 'literary'),
];

export const essays = [
  U(MON + 'lincoln/gettysburg.html', 'Gettysburg Address', 'Abraham Lincoln', 'politics', 1),
  U(PG + 'disagree.html', 'How to Disagree', 'Paul Graham', 'wildcard', 6),
  U(PG + 'talk.html', 'Write Like You Talk', 'Paul Graham', 'writing', 3),
  U(PG + 'goodtaste.html', 'Is There Such a Thing as Good Taste?', 'Paul Graham', 'art', 4),
  U(MON + 'lincoln/second-inaugural.html', 'Second Inaugural Address', 'Abraham Lincoln', 'politics', 3),
  U(MON + 'bourne/discussion.html', 'On Discussion', 'Randolph Bourne', 'wildcard', 6),
  U(PG + 'words.html', 'Putting Ideas into Words', 'Paul Graham', 'writing', 5),
  U(PG + 'top.html', 'The Top Idea in Your Mind', 'Paul Graham', 'wildcard', 5),
  U(MON + 'montaigne/intention2.html', 'That the Intention Is Judge of Our Actions', 'Michel de Montaigne', 'philosophy', 3),
  U(PG + 'smart.html', 'Beyond Smart', 'Paul Graham', 'wildcard', 6),
  U(MON + 'addison/friendship.html', 'The Qualifications of Friendship', 'Joseph Addison', 'philosophy', 4),
  U(MON + 'hume/platonist.html', 'The Platonist', 'David Hume', 'philosophy', 5),
  U(MON + 'franklin/junto.html', 'The Junto', 'Benjamin Franklin', 'history', 5),
  U('https://brevitymag.com/nonfiction/plenty-of-time/', 'Plenty of Time', '?', 'memoir', 3),
  U('https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/just-junk-but-who-could-resist-it/', 'Just Junk – But Who Could Resist It?', 'George Orwell', 'wildcard', 5),
  U(PG + 'kids.html', 'Having Kids', 'Paul Graham', 'wildcard', 6),
  U('https://orwellfoundation.com/george-orwell/by-orwell/essays-and-other-works/freedom-of-the-park/', 'Freedom of the Park', 'George Orwell', 'politics', 5),
  U('https://psyche.co/ideas/mother-teresa-was-virtuous-but-she-was-wrong-about-virtue', 'Mother Teresa was virtuous, but she was wrong about virtue', '?', 'philosophy', 9),
  U(MON + 'santayana/carnival.html', 'Carnival', 'George Santayana', 'wildcard', 9),
  U(MON + 'santayana/skylarks.html', 'Skylarks', 'George Santayana', 'wildcard', 11),
];
