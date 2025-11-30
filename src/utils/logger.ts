export const logger = {
  success(message: string): void {
    console.log(`✓ ${message}`);
  },

  error(message: string): void {
    console.error(`✗ ${message}`);
  },

  info(message: string): void {
    console.log(message);
  },

  step(message: string): void {
    console.log(`→ ${message}`);
  },

  section(message: string): void {
    console.log(`\n${message}`);
  },

  blank(): void {
    console.log();
  },
};
