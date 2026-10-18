import { greet, createProject } from './src/project.ts';

// Welcome to Orbit. A little space for your next big idea.
// Try F12 on createProject, or Ctrl+Space after project.

const project = createProject('Something wonderful');

function start(): void {
  console.log(greet('builder'));
  console.log(`Project: ${project.name}`);
  console.log(`Status: ${project.status}`);

  for (const step of project.steps) {
    console.log(`  → ${step}`);
  }
}

start();

// Your next chapter starts here.
//
// Ctrl+S         Save your changes
// Ctrl+P         Jump to a file
// Ctrl+Shift+P   Find any command
// Ctrl+D         Select the next occurrence
// F5             Run this file in the terminal
