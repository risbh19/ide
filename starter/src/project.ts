export interface Project {
  name: string;
  status: 'just getting started' | 'in progress' | 'shipped';
  steps: string[];
}

export function greet(name: string): string {
  return `Hello, ${name}. Let's make something.`;
}

export function createProject(name: string): Project {
  return {
    name,
    status: 'just getting started',
    steps: ['Follow your curiosity', 'Make a small thing', 'Keep going'],
  };
}
