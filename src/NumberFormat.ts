const integers = new Intl.NumberFormat("en-US", {maximumFractionDigits: 0});
/** UI text only: never use formatted values for coordinates, keys or SVG paths. */
export const formatInteger = (value: number) => integers.format(value);
