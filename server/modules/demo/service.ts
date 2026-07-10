// O0 demo module service — business logic between the router and the store.
// Thin here (the demo is a template), but the seam exists so real modules keep
// HTTP concerns out of persistence code.
import { addItem, listItems, searchItems } from "./store";
import type { DemoItem } from "./schema";

export const createItem = (text: string): Promise<DemoItem> => addItem(text);
export const getItems = (): Promise<DemoItem[]> => listItems();
export const search = (q: string): Promise<{ id: string; text: string; distance: number }[]> => searchItems(q);

/** Backing logic for the demo_echo tool. Kept in the service (not the tool
 *  literal) so it flows through the same layer as the routes. */
export const echo = (text: unknown): { echoed: unknown } => ({ echoed: text ?? null });
