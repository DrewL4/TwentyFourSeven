export type LibraryContentView = "all" | "shows" | "movies";

export interface LibraryFilterState {
  contentView: LibraryContentView;
  libraryId: string;
  collection: string | null;
}

export const DEFAULT_LIBRARY_FILTERS: LibraryFilterState = {
  contentView: "all",
  libraryId: "",
  collection: null,
};
