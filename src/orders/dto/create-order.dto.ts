export class CreateOrderDto {
  items: {
    serviceId: string;
    quantity: number;
  }[];
}
