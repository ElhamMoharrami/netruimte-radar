import type { CongestionContext } from '@netruimte/shared';

export interface GridQuery {
  latitude?: number;
  longitude?: number;
  postcode?: string;
  city?: string;
}

export interface GridContextProvider {
  readonly name: string;
  getGridContext(query: GridQuery): Promise<CongestionContext>;
}
