#!/usr/bin/env node
import { Command } from "commander";
import { configCommand } from "./commands/config.js";
import { commissionCommand } from "./commands/commission.js";
import { bidCommand } from "./commands/bid.js";
import { matchCommand } from "./commands/match.js";
import { serveCommand } from "./commands/serve.js";
import { pricingCommand } from "./commands/pricing.js";
import { deliverCommand } from "./commands/deliver.js";
import { msgCommand } from "./commands/msg.js";
import { reputationCommand } from "./commands/reputation.js";

const program = new Command();

program
  .name("inter-knot")
  .description("Inter-Knot protocol CLI — agent-native task trading on Solana")
  .version("0.1.0");

program.addCommand(configCommand());
program.addCommand(commissionCommand());
program.addCommand(bidCommand());
program.addCommand(matchCommand());
program.addCommand(serveCommand());
program.addCommand(pricingCommand());
program.addCommand(deliverCommand());
program.addCommand(msgCommand());
program.addCommand(reputationCommand());

program.parse(process.argv);
