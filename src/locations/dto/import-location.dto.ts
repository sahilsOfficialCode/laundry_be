/**
 * Shape expected in each element of the uploaded JSON array.
 * Complex fields (workingSchedule, slots) are optional and default to empty.
 */
export interface LocationImportRow {
  shopName: string;
  city: string;
  fullAddress: string;
  contactNumber: string;

  /** Direct lat/lng — converted to GeoJSON internally */
  latitude: number;
  longitude: number;

  /** 'radius' | 'polygon' — defaults to 'radius' */
  serviceAreaType?: string;
  /** Required when serviceAreaType = 'radius' */
  serviceRadiusKm?: number;
  /** Required when serviceAreaType = 'polygon' */
  servicePolygon?: number[][][];

  timezone?: string;
  dailyBookingLimit?: number;
  isActive?: boolean;
  pricingProfileKey?: string;
  supportedServiceIds?: string[];
  enabledPaymentMethods?: string[];

  workingSchedule?: Array<{
    day: string;
    isOpen: boolean;
    openTime?: string;
    closeTime?: string;
  }>;

  pickupSlots?: Array<{
    label: string;
    startTime: string;
    endTime: string;
    capacity?: number;
  }>;

  deliverySlots?: Array<{
    label: string;
    startTime: string;
    endTime: string;
    capacity?: number;
  }>;
}

export interface LocationImportResult {
  imported: number;
  failed: number;
  errors: Array<{ row: number; shopName?: string; reason: string }>;
}
