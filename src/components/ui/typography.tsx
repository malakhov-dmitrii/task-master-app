export interface TypographyProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
}

export function TypographyH1(props: TypographyProps) {
  return <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl" {...props} />;
}

export function TypographyH2(props: TypographyProps) {
  return <h2 className="scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0" {...props} />;
}

export function TypographyH3(props: TypographyProps) {
  return <h3 className="scroll-m-20 text-2xl font-semibold tracking-tight" {...props} />;
}

export function TypographyP(props: TypographyProps) {
  return <p className="leading-7 [&:not(:first-child)]:mt-6" {...props} />;
}

export function TypographyList(props: TypographyProps) {
  return <ul className="my-6 ml-6 list-disc [&>li]:mt-2" {...props} />;
}
