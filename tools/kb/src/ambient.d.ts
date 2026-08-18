declare module "picomatch" {
  type Matcher = (input: string) => boolean;
  type Options = { dot?: boolean; strictBrackets?: boolean };
  export default function picomatch(
    pattern: string,
    options?: Options,
  ): Matcher;
}
