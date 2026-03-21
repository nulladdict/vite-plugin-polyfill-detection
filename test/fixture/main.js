const flat = [1, [2, 3]].flat();
const entries = Object.fromEntries([["a", 1], ["b", 2]]);
const text = "hello world".replaceAll("o", "0");
console.log(flat, entries, text);
