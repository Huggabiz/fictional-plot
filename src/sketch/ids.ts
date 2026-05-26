let counter = 0;

export const nextId = (prefix: string): string => `${prefix}_${++counter}`;
