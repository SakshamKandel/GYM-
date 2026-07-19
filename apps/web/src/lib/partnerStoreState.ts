export interface PartnerStoreState {
  totalMeals: number;
  activeMeals: number;
  paused: boolean;
}

/** Pure store projection: partner pause and per-item stock stay independent. */
export function derivePartnerStoreState(
  menu: readonly { isActive: boolean }[],
  acceptingOrders: boolean,
): PartnerStoreState {
  return {
    totalMeals: menu.length,
    activeMeals: menu.filter((item) => item.isActive).length,
    paused: !acceptingOrders,
  };
}
