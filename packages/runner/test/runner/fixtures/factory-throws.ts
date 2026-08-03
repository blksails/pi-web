// Invalid: shape (b) factory throws when invoked.
export default () => {
  throw new Error("boom from factory");
};
