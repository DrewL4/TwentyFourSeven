export function TmdbAttribution() {
  return (
    <p className="text-xs text-muted-foreground leading-relaxed pt-2 border-t">
      Franchise data from{" "}
      <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="underline">
        TMDB
      </a>
      . This product uses the TMDB API but is not endorsed or certified by TMDB.
    </p>
  );
}
