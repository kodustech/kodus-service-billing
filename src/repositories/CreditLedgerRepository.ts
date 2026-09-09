import { AppDataSource } from "../config/database";
import { CreditLedgerEntry } from "../entities/CreditLedgerEntry";

export const CreditLedgerRepository =
  AppDataSource.getRepository(CreditLedgerEntry);
