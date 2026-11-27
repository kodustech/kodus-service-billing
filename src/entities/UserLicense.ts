import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { OrganizationLicense } from "./OrganizationLicense";
import { ConnectionLicense } from "./ConnectionLicense";

export enum LicenseStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export enum GitTool {
  GITHUB = "github",
  GITLAB = "gitlab",
  BITBUCKET = "bitbucket",
  AZURE_REPOS = "azure_repos",
  FORGEJO = "forgejo",
}

@Entity("user_licenses")
@Index("IDX_user_licenses_org_license_id", ["organizationLicenseId"])
@Index("IDX_user_licenses_orgid_status", ["organizationLicenseId", "licenseStatus"])
@Index("IDX_user_licenses_git_id", ["git_id"])
@Index("IDX_user_licenses_git_id_tool", ["git_id", "git_tool"])
@Index("IDX_user_licenses_license_status", ["licenseStatus"])
@Index("IDX_user_licenses_connection_license_status", ["connectionLicenseId", "licenseStatus"])
export class UserLicense {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  git_id: string;

  @Column({
    type: "enum",
    enum: LicenseStatus,
    default: LicenseStatus.ACTIVE,
  })
  licenseStatus: LicenseStatus;

  @Column({
    type: "enum",
    enum: GitTool,
  })
  git_tool: GitTool;

  @Column({ type: "timestamp" })
  assignedAt: Date;

  @Column()
  organizationLicenseId: string;

  @ManyToOne(() => OrganizationLicense)
  @JoinColumn({ name: "organizationLicenseId" })
  organizationLicense: OrganizationLicense;

  /** Null: a seat of the workspace's primary connection. */
  @Column({ type: "uuid", nullable: true })
  connectionLicenseId: string | null;

  @ManyToOne(() => ConnectionLicense, { onDelete: "CASCADE" })
  @JoinColumn({ name: "connectionLicenseId" })
  connectionLicense?: ConnectionLicense;

  /** Server the git id belongs to (github.com, a GitLab host...). */
  @Column({ type: "varchar", nullable: true })
  git_host: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
