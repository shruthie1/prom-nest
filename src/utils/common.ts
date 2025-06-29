export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function contains(str: string | null | undefined, arr: string[]): boolean {
  if (!str || !Array.isArray(arr)) return false;
  return arr.some(element => element && str.includes(element.toLowerCase()));
}

export function toBoolean(value: string | number | boolean | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const normalizedValue = value.toLowerCase().trim();
    return normalizedValue === 'true' || normalizedValue === '1' || normalizedValue === 'yes';
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return value;
}

export function fetchNumbersFromString(inputString: string | null | undefined): string {
  if (!inputString) return '';
  const regex = /\d+/g;
  const matches = inputString.match(regex);
  return matches ? matches.join('') : '';
}

export const defaultReactions = Object.freeze([
  '❤', '🔥', '👏', '🥰', '😁', '🤔',
  '🤯', '😱', '🤬', '😢', '🎉', '🤩',
  '🤮', '💩', '🙏', '👌', '🕊', '🤡',
  '🥱', '🥴', '😍', '🐳', '❤‍🔥', '💯',
  '🤣', '💔', '🏆', '😭', '😴', '👍',
  '🌚', '⚡', '🍌', '😐', '💋', '👻',
  '👀', '🙈', '🤝', '🤗', '🆒',
  '🗿', '🙉', '🙊', '🤷', '👎'
] as const);

export const defaultMessages = Object.freeze([
  "1", "2", "3", "4", "5", "6", "7", "8",
  "9", "10", "11", "12", "13", "14", "15",
  "16", "17", "18", "19", "20", "21"
] as const);

export function areJsonsNotSame(json1: unknown, json2: unknown): boolean {
  const keysToIgnore = ['id', '_id', 'createdAt', 'updatedAt', 'timestamp', 'time', 'date', 'timeStamp', 'created_at', 'updated_at'];
  const MAX_DEPTH = 10;

  function compare(obj1: unknown, obj2: unknown, path: string = '', depth: number = 0): boolean {
    // Stop recursion at max depth
    if (depth > MAX_DEPTH) {
      console.log(`[DEPTH LIMIT] Reached max depth at path: ${path}`);
      return obj1 !== obj2;
    }

    // Handle null/undefined
    if (obj1 === null || obj1 === undefined || obj2 === null || obj2 === undefined) {
      if (obj1 !== obj2) {
        console.log(`[MISMATCH] ${path}: ${obj1} !== ${obj2}`);
        return true;
      }
      return false;
    }

    // Handle different types
    if (typeof obj1 !== typeof obj2) {
      console.log(`[MISMATCH] ${path}: type ${typeof obj1} !== ${typeof obj2}`);
      return true;
    }

    // Handle non-objects (primitives)
    if (typeof obj1 !== 'object') {
      if (obj1 !== obj2) {
        console.log(`[MISMATCH] ${path}: ${obj1} !== ${obj2}`);
        return true;
      }
      return false;
    }

    // Handle arrays
    if (Array.isArray(obj1) && Array.isArray(obj2)) {
      if (obj1.length !== obj2.length) {
        console.log(`[MISMATCH] ${path}: array length ${obj1.length} !== ${obj2.length}`);
        return true;
      }

      for (let i = 0; i < obj1.length; i++) {
        const arrayPath = path ? `${path}[${i}]` : `[${i}]`;
        if (compare(obj1[i], obj2[i], arrayPath, depth + 1)) {
          return true;
        }
      }
      return false;
    }

    // Handle array vs non-array
    if (Array.isArray(obj1) || Array.isArray(obj2)) {
      console.log(obj1, obj2);
      console.log(`[MISMATCH] ${path}: one is array, other is not`);
      return true;
    }

    // Handle objects
    const record1 = obj1 as Record<string, unknown>;
    const record2 = obj2 as Record<string, unknown>;

    // Get all keys (excluding ignored ones)
    const keys1 = Object.keys(record1).filter(key => !keysToIgnore.includes(key));
    const keys2 = Object.keys(record2).filter(key => !keysToIgnore.includes(key));

    // Check if different number of keys
    if (keys1.length !== keys2.length) {
      console.log(`[MISMATCH] ${path}: different key count ${keys1.length} !== ${keys2.length}`);
      console.log(`[KEYS] obj1: [${keys1.join(', ')}]`);
      console.log(`[KEYS] obj2: [${keys2.join(', ')}]`);
      return true;
    }

    // Check if all keys from obj1 exist in obj2
    for (const key of keys1) {
      if (!keys2.includes(key)) {
        console.log(`[MISMATCH] ${path}: key "${key}" missing in obj2`);
        return true;
      }
    }

    // Compare values for each key
    for (const key of keys1) {
      const keyPath = path ? `${path}.${key}` : key;
      if (compare(record1[key], record2[key], keyPath, depth + 1)) {
        return true;
      }
    }

    return false;
  }

  const result = compare(json1, json2);
  console.log(`[COMPARISON END] Result: ${result ? 'DIFFERENT' : 'SAME'}`);

  return result;
}

export function mapToJson<K extends string | number | symbol, V>(map: Map<K, V>): Record<string, V> {
  if (!(map instanceof Map)) {
    throw new Error('Input must be a Map instance');
  }
  const obj: Record<string, V> = {};
  for (const [key, value] of map.entries()) {
    obj[String(key)] = value;
  }
  return obj;
}

export function shouldMatch(obj) {
  const regex = /(wife|adult|lanj|chat|𝑭𝒂𝒎𝒊𝒍𝒚|𝙏𝙖𝙢𝙞𝙡|𝐒𝐖𝐀𝐏|lesb|aunty|girl|boy|tamil|kannad|telugu|hindi|paid|coupl|cpl|randi|bhab|boy|girl|friend|frnd|boob|pussy|dating|swap|gay|sex|bitch|love|video|service|real|call|desi)/i
  const titleMatch = obj.title && regex.test(obj.title);
  const usernameMatch = obj.username && regex.test(obj.username);
  return !!(titleMatch || usernameMatch);
}