export function reorderItems<T extends { id: string; order: number }>(
  items: T[],
  sourceIndex: number,
  destinationIndex: number
): T[] {
  const result = Array.from(items);
  const [removed] = result.splice(sourceIndex, 1);
  result.splice(destinationIndex, 0, removed);

  // Update order values to match new positions
  return result.map((item, index) => ({
    ...item,
    order: index
  }));
}

export function createOptimisticReorderUpdate<T extends { id: string; order: number }>(
  sourceIndex: number,
  destinationIndex: number
) {
  return (variables: any, previousData: any) => {
    if (!previousData || !Array.isArray(previousData)) {
      return previousData;
    }

    return reorderItems(previousData, sourceIndex, destinationIndex);
  };
}

export function createChannelContentReorderUpdate(
  sourceIndex: number,
  destinationIndex: number,
  contentType: 'shows' | 'movies'
) {
  return (variables: any, previousData: any) => {
    if (!previousData) return previousData;

    const propertyName = contentType === 'shows' ? 'channelShows' : 'channelMovies';
    const items = previousData[propertyName] || [];
    
    const reorderedItems = reorderItems(items, sourceIndex, destinationIndex);
    
    return {
      ...previousData,
      [propertyName]: reorderedItems
    };
  };
} 