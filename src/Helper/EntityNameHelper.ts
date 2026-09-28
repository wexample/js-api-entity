export function lowerFirstCharacter(value: string): string {
  if (!value) {
    return value;
  }

  return value[0].toLowerCase() + value.slice(1);
}
