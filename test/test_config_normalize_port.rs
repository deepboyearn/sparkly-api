//! Test port clamping in the range 10000–65535.

#[cfg(test)]
mod tests {
    use sparkly::types::{BridgeConfig, MAX_LOCAL_PORT, MIN_LOCAL_PORT};

    #[test]
    fn min_port_constant_is_10000() {
        assert_eq!(MIN_LOCAL_PORT, 10_000);
    }

    #[test]
    fn max_port_constant_is_65535() {
        assert_eq!(MAX_LOCAL_PORT, 65_535);
    }

    #[test]
    fn deserialize_local_port_from_valid_json() {
        let json = r#"{"localPort": 48231}"#;
        let val: serde_json::Value = serde_json::from_str(json).unwrap();
        let port_val = val.get("localPort").and_then(|v| v.as_f64()).unwrap() as i64;
        let clamped = port_val.clamp(MIN_LOCAL_PORT as i64, MAX_LOCAL_PORT as i64) as u16;
        assert_eq!(clamped, 48231);
    }

    #[test]
    fn port_below_minimum_clamped_to_min() {
        let port_val: i64 = 80;
        let clamped = port_val.clamp(MIN_LOCAL_PORT as i64, MAX_LOCAL_PORT as i64) as u16;
        assert_eq!(clamped, MIN_LOCAL_PORT);
    }

    #[test]
    fn port_above_maximum_clamped_to_max() {
        let port_val: i64 = 99999;
        let clamped = port_val.clamp(MIN_LOCAL_PORT as i64, MAX_LOCAL_PORT as i64) as u16;
        assert_eq!(clamped, MAX_LOCAL_PORT);
    }

    #[test]
    fn port_zero_clamped_to_min() {
        let port_val: i64 = 0;
        let clamped = port_val.clamp(MIN_LOCAL_PORT as i64, MAX_LOCAL_PORT as i64) as u16;
        assert_eq!(clamped, MIN_LOCAL_PORT);
    }

    #[test]
    fn port_at_minimum_stays() {
        let port_val: i64 = MIN_LOCAL_PORT as i64;
        let clamped = port_val.clamp(MIN_LOCAL_PORT as i64, MAX_LOCAL_PORT as i64) as u16;
        assert_eq!(clamped, MIN_LOCAL_PORT);
    }

    #[test]
    fn port_at_maximum_stays() {
        let port_val: i64 = MAX_LOCAL_PORT as i64;
        let clamped = port_val.clamp(MIN_LOCAL_PORT as i64, MAX_LOCAL_PORT as i64) as u16;
        assert_eq!(clamped, MAX_LOCAL_PORT);
    }

    #[test]
    fn negative_port_clamped_to_min() {
        let port_val: i64 = -1;
        let clamped = port_val.clamp(MIN_LOCAL_PORT as i64, MAX_LOCAL_PORT as i64) as u16;
        assert_eq!(clamped, MIN_LOCAL_PORT);
    }

    #[test]
    fn default_port_is_within_valid_range() {
        let default = sparkly::types::DEFAULT_LOCAL_PORT;
        assert!(
            default >= MIN_LOCAL_PORT && default <= MAX_LOCAL_PORT,
            "default port {} should be within [{}, {}]",
            default, MIN_LOCAL_PORT, MAX_LOCAL_PORT
        );
    }

    #[test]
    fn default_config_has_valid_port() {
        let config = BridgeConfig::default();
        assert!(
            config.local_port >= MIN_LOCAL_PORT && config.local_port <= MAX_LOCAL_PORT,
            "default config port {} should be within valid range",
            config.local_port
        );
    }
}
