export const availabilityLabels = {
  in_stock: "In stock",
  made_to_order: "Made to order",
  unavailable: "Unavailable",
};

const priceFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export const formatPrice = (value: number) => priceFormatter.format(value);
