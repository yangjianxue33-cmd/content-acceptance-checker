export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      analysis_modules: {
        Row: {
          ai_risk: Database["public"]["Enums"]["ai_risk"] | null
          caveats: string[]
          completed_at: string | null
          created_at: string
          error_code: string | null
          id: string
          module: Database["public"]["Enums"]["analysis_module"]
          review_id: string
          score: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["module_status"]
          summary: string | null
          updated_at: string
        }
        Insert: {
          ai_risk?: Database["public"]["Enums"]["ai_risk"] | null
          caveats?: string[]
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          module: Database["public"]["Enums"]["analysis_module"]
          review_id: string
          score?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["module_status"]
          summary?: string | null
          updated_at?: string
        }
        Update: {
          ai_risk?: Database["public"]["Enums"]["ai_risk"] | null
          caveats?: string[]
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          module?: Database["public"]["Enums"]["analysis_module"]
          review_id?: string
          score?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["module_status"]
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_modules_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      citation_checks: {
        Row: {
          created_at: string
          id: string
          module: Database["public"]["Enums"]["analysis_module"]
          normalized_url: string | null
          reason_code: string | null
          result_category: string
          review_id: string
          status_code: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          module?: Database["public"]["Enums"]["analysis_module"]
          normalized_url?: string | null
          reason_code?: string | null
          result_category: string
          review_id: string
          status_code?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          module?: Database["public"]["Enums"]["analysis_module"]
          normalized_url?: string | null
          reason_code?: string | null
          result_category?: string
          review_id?: string
          status_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "citation_checks_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      issues: {
        Row: {
          confidence: Database["public"]["Enums"]["confidence_band"] | null
          created_at: string
          explanation: string
          id: string
          include_in_writer_checklist: boolean
          issue_type: string
          module: Database["public"]["Enums"]["analysis_module"]
          related_requirement_id: string | null
          review_id: string
          severity: Database["public"]["Enums"]["issue_severity"]
          source_end: number | null
          source_excerpt: string | null
          source_start: number | null
          suggested_action: string
          updated_at: string
          user_feedback: boolean | null
        }
        Insert: {
          confidence?: Database["public"]["Enums"]["confidence_band"] | null
          created_at?: string
          explanation: string
          id?: string
          include_in_writer_checklist?: boolean
          issue_type: string
          module: Database["public"]["Enums"]["analysis_module"]
          related_requirement_id?: string | null
          review_id: string
          severity: Database["public"]["Enums"]["issue_severity"]
          source_end?: number | null
          source_excerpt?: string | null
          source_start?: number | null
          suggested_action: string
          updated_at?: string
          user_feedback?: boolean | null
        }
        Update: {
          confidence?: Database["public"]["Enums"]["confidence_band"] | null
          created_at?: string
          explanation?: string
          id?: string
          include_in_writer_checklist?: boolean
          issue_type?: string
          module?: Database["public"]["Enums"]["analysis_module"]
          related_requirement_id?: string | null
          review_id?: string
          severity?: Database["public"]["Enums"]["issue_severity"]
          source_end?: number | null
          source_excerpt?: string | null
          source_start?: number | null
          suggested_action?: string
          updated_at?: string
          user_feedback?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "issues_related_requirement_same_review_fk"
            columns: ["review_id", "related_requirement_id"]
            isOneToOne: false
            referencedRelation: "requirements"
            referencedColumns: ["review_id", "id"]
          },
          {
            foreignKeyName: "issues_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      requirements: {
        Row: {
          category: string
          created_at: string
          evaluation_result:
            | Database["public"]["Enums"]["requirement_evaluation"]
            | null
          id: string
          is_critical: boolean
          requirement_text: string
          review_id: string
          source_excerpt: string | null
          updated_at: string
          user_confirmed: boolean
        }
        Insert: {
          category: string
          created_at?: string
          evaluation_result?:
            | Database["public"]["Enums"]["requirement_evaluation"]
            | null
          id?: string
          is_critical?: boolean
          requirement_text: string
          review_id: string
          source_excerpt?: string | null
          updated_at?: string
          user_confirmed?: boolean
        }
        Update: {
          category?: string
          created_at?: string
          evaluation_result?:
            | Database["public"]["Enums"]["requirement_evaluation"]
            | null
          id?: string
          is_critical?: boolean
          requirement_text?: string
          review_id?: string
          source_excerpt?: string | null
          updated_at?: string
          user_confirmed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "requirements_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      review_decisions: {
        Row: {
          created_at: string
          decision: Database["public"]["Enums"]["user_decision"]
          id: string
          review_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decision: Database["public"]["Enums"]["user_decision"]
          id?: string
          review_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decision?: Database["public"]["Enums"]["user_decision"]
          id?: string
          review_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_decisions_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: true
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      review_files: {
        Row: {
          created_at: string
          file_kind: Database["public"]["Enums"]["file_kind"]
          id: string
          mime_type: string
          object_path: string
          original_filename: string | null
          review_id: string
          size_bytes: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          file_kind: Database["public"]["Enums"]["file_kind"]
          id?: string
          mime_type: string
          object_path: string
          original_filename?: string | null
          review_id: string
          size_bytes: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          file_kind?: Database["public"]["Enums"]["file_kind"]
          id?: string
          mime_type?: string
          object_path?: string
          original_filename?: string | null
          review_id?: string
          size_bytes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_files_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          anonymous_access_token_hash: string | null
          brief_present: boolean
          content_type: Database["public"]["Enums"]["content_type"]
          created_at: string
          delete_at: string
          id: string
          original_filename: string | null
          overall_score: number | null
          owner_id: string | null
          source_input_type: Database["public"]["Enums"]["source_input_type"]
          source_text_encrypted: string | null
          status: Database["public"]["Enums"]["review_status"]
          system_recommendation:
            | Database["public"]["Enums"]["system_recommendation"]
            | null
          title: string
          updated_at: string
          word_count: number
        }
        Insert: {
          anonymous_access_token_hash?: string | null
          brief_present?: boolean
          content_type: Database["public"]["Enums"]["content_type"]
          created_at?: string
          delete_at: string
          id?: string
          original_filename?: string | null
          overall_score?: number | null
          owner_id?: string | null
          source_input_type: Database["public"]["Enums"]["source_input_type"]
          source_text_encrypted?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          system_recommendation?:
            | Database["public"]["Enums"]["system_recommendation"]
            | null
          title: string
          updated_at?: string
          word_count: number
        }
        Update: {
          anonymous_access_token_hash?: string | null
          brief_present?: boolean
          content_type?: Database["public"]["Enums"]["content_type"]
          created_at?: string
          delete_at?: string
          id?: string
          original_filename?: string | null
          overall_score?: number | null
          owner_id?: string | null
          source_input_type?: Database["public"]["Enums"]["source_input_type"]
          source_text_encrypted?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          system_recommendation?:
            | Database["public"]["Enums"]["system_recommendation"]
            | null
          title?: string
          updated_at?: string
          word_count?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_analysis_module: {
        Args: {
          p_module: Database["public"]["Enums"]["analysis_module"]
          p_review_id: string
        }
        Returns: boolean
      }
      create_anonymous_review: {
        Args: {
          p_access_token_hash: string
          p_brief_present: boolean
          p_content_type: Database["public"]["Enums"]["content_type"]
          p_delete_at: string
          p_files: Json
          p_original_filename: string
          p_review_id: string
          p_source_input_type: Database["public"]["Enums"]["source_input_type"]
          p_source_text_encrypted: string
          p_status: Database["public"]["Enums"]["review_status"]
          p_title: string
          p_word_count: number
        }
        Returns: string
      }
      finalize_review_analysis: {
        Args: {
          p_overall_score: number
          p_recommendation: Database["public"]["Enums"]["system_recommendation"]
          p_review_id: string
        }
        Returns: Database["public"]["Enums"]["review_status"]
      }
      persist_analysis_module_result: {
        Args: {
          p_ai_risk: Database["public"]["Enums"]["ai_risk"]
          p_caveats: string[]
          p_citation_checks: Json
          p_error_code: string
          p_issues: Json
          p_module: Database["public"]["Enums"]["analysis_module"]
          p_requirement_evaluations: Json
          p_review_id: string
          p_score: number
          p_status: Database["public"]["Enums"]["module_status"]
          p_summary: string
        }
        Returns: undefined
      }
      replace_review_requirements: {
        Args: {
          p_access_token_hash: string
          p_confirm: boolean
          p_requirements: Json
          p_review_id: string
        }
        Returns: Database["public"]["Enums"]["review_status"]
      }
      start_anonymous_review_analysis: {
        Args: { p_access_token_hash: string; p_review_id: string }
        Returns: Database["public"]["Enums"]["review_status"]
      }
    }
    Enums: {
      ai_risk: "low" | "medium" | "high" | "not_assessed"
      analysis_module:
        | "brief_fit"
        | "evidence_citations"
        | "editorial_quality"
        | "ai_risk"
      confidence_band: "low" | "medium" | "high"
      content_type: "blog_post" | "seo_article" | "thought_leadership" | "other"
      file_kind: "source" | "brief"
      issue_severity: "critical" | "major" | "minor"
      module_status:
        | "queued"
        | "reviewing"
        | "complete"
        | "not_assessed"
        | "unavailable"
      requirement_evaluation: "met" | "partial" | "missing" | "not_assessed"
      review_status:
        | "draft"
        | "extracting"
        | "awaiting_brief_confirmation"
        | "queued"
        | "reviewing"
        | "completed"
        | "partial"
        | "failed"
        | "deleted"
      source_input_type: "pasted_text" | "uploaded_file"
      system_recommendation:
        | "ready_to_approve"
        | "request_revisions"
        | "manual_review_required"
      user_decision: "ready" | "revisions_requested" | "manually_reviewed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ai_risk: ["low", "medium", "high", "not_assessed"],
      analysis_module: [
        "brief_fit",
        "evidence_citations",
        "editorial_quality",
        "ai_risk",
      ],
      confidence_band: ["low", "medium", "high"],
      content_type: ["blog_post", "seo_article", "thought_leadership", "other"],
      file_kind: ["source", "brief"],
      issue_severity: ["critical", "major", "minor"],
      module_status: [
        "queued",
        "reviewing",
        "complete",
        "not_assessed",
        "unavailable",
      ],
      requirement_evaluation: ["met", "partial", "missing", "not_assessed"],
      review_status: [
        "draft",
        "extracting",
        "awaiting_brief_confirmation",
        "queued",
        "reviewing",
        "completed",
        "partial",
        "failed",
        "deleted",
      ],
      source_input_type: ["pasted_text", "uploaded_file"],
      system_recommendation: [
        "ready_to_approve",
        "request_revisions",
        "manual_review_required",
      ],
      user_decision: ["ready", "revisions_requested", "manually_reviewed"],
    },
  },
} as const
