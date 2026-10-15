// Curated catalog of 20 crowd-pleasing movies that are likely to have at least
// one working source in Movix's extraction pipeline. These are surfaced first
// in the Movies page so users land on a short, reliable "streamable now" shelf.
//
// poster_path / backdrop_path are left to TMDB (useTmdbImages resolves the
// localized assets from the tmdb id), which keeps this list resilient to TMDB
// image path changes.

export interface CuratedMovie {
  id: number;
  title: string;
  overview: string;
  poster_path: string;
  backdrop_path: string;
  release_date: string;
  vote_average: number;
  genre_ids: number[];
  media_type?: 'movie';
}

export const CURATED_STREAMABLE_MOVIES: CuratedMovie[] = [
  { id: 27205, title: 'Inception', overview: 'A thief who steals corporate secrets through dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.', poster_path: '', backdrop_path: '', release_date: '2010-07-16', vote_average: 8.4, genre_ids: [28, 878, 53] },
  { id: 157336, title: 'Interstellar', overview: 'A team of explorers travel through a wormhole in space in an attempt to ensure humanity\'s survival.', poster_path: '', backdrop_path: '', release_date: '2014-11-07', vote_average: 8.6, genre_ids: [12, 18, 878] },
  { id: 155, title: 'The Dark Knight', overview: 'Batman raises the stakes in his war on crime.', poster_path: '', backdrop_path: '', release_date: '2008-07-18', vote_average: 8.5, genre_ids: [28, 80, 18] },
  { id: 299534, title: 'Avengers: Endgame', overview: 'After the devastating events, the Avengers assemble once more.', poster_path: '', backdrop_path: '', release_date: '2019-04-26', vote_average: 8.3, genre_ids: [28, 12, 878] },
  { id: 693134, title: 'Dune: Part Two', overview: 'Paul Atreides unites with Chani and the Fremen.', poster_path: '', backdrop_path: '', release_date: '2024-02-29', vote_average: 8.2, genre_ids: [878, 12] },
  { id: 634649, title: 'Spider-Man: No Way Home', overview: 'Peter Parker asks Doctor Strange for help.', poster_path: '', backdrop_path: '', release_date: '2021-12-17', vote_average: 8.0, genre_ids: [28, 12, 878] },
  { id: 603, title: 'The Matrix', overview: 'A hacker discovers the truth about reality.', poster_path: '', backdrop_path: '', release_date: '1999-03-31', vote_average: 8.2, genre_ids: [28, 878] },
  { id: 98, title: 'Gladiator', overview: 'A betrayed Roman general seeks revenge.', poster_path: '', backdrop_path: '', release_date: '2000-05-05', vote_average: 8.2, genre_ids: [28, 18, 12] },
  { id: 278, title: 'The Shawshank Redemption', overview: 'Two imprisoned men bond over years.', poster_path: '', backdrop_path: '', release_date: '1994-09-23', vote_average: 8.7, genre_ids: [18, 80] },
  { id: 550, title: 'Fight Club', overview: 'An insomniac and a soap-maker form an underground fight club.', poster_path: '', backdrop_path: '', release_date: '1999-10-15', vote_average: 8.4, genre_ids: [18, 53, 80] },
  { id: 496243, title: 'Parasite', overview: 'A poor family infiltrates a wealthy household.', poster_path: '', backdrop_path: '', release_date: '2019-10-24', vote_average: 8.5, genre_ids: [53, 18, 35] },
  { id: 244786, title: 'Whiplash', overview: 'A promising drummer enrolls at a cut-throat music conservatory.', poster_path: '', backdrop_path: '', release_date: '2014-10-10', vote_average: 8.4, genre_ids: [18, 10402] },
  { id: 238, title: 'The Godfather', overview: 'The aging patriarch of an organized crime dynasty transfers control to his reluctant son.', poster_path: '', backdrop_path: '', release_date: '1972-03-24', vote_average: 8.7, genre_ids: [18, 80] },
  { id: 680, title: 'Pulp Fiction', overview: 'A series of interconnected stories in the criminal underworld.', poster_path: '', backdrop_path: '', release_date: '1994-09-10', vote_average: 8.5, genre_ids: [53, 80] },
  { id: 129, title: 'Spirited Away', overview: 'A girl wanders into a world run by gods and witches.', poster_path: '', backdrop_path: '', release_date: '2001-07-20', vote_average: 8.8, genre_ids: [16, 10751, 14] },
  { id: 372058, title: 'Your Name', overview: 'Two strangers are connected through their dreams.', poster_path: '', backdrop_path: '', release_date: '2016-08-26', vote_average: 8.5, genre_ids: [16, 10749, 18] },
  { id: 324857, title: 'Spider-Man: Into the Spider-Verse', overview: 'Teen Miles Morales becomes Spider-Man of his reality.', poster_path: '', backdrop_path: '', release_date: '2018-12-14', vote_average: 8.4, genre_ids: [28, 12, 16] },
  { id: 872585, title: 'Oppenheimer', overview: 'The story of J. Robert Oppenheimer and the atomic bomb.', poster_path: '', backdrop_path: '', release_date: '2023-07-21', vote_average: 8.1, genre_ids: [18, 36] },
  { id: 361743, title: 'Top Gun: Maverick', overview: 'Maverick confronts ghosts and trains a new generation.', poster_path: '', backdrop_path: '', release_date: '2022-05-27', vote_average: 8.3, genre_ids: [28, 18] },
  { id: 569094, title: 'Spider-Man: Across the Spider-Verse', overview: 'Miles goes on a multiverse-spanning adventure.', poster_path: '', backdrop_path: '', release_date: '2023-06-02', vote_average: 8.3, genre_ids: [28, 12, 16] },
];
