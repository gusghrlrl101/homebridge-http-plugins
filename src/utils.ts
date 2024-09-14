import axios from 'axios';

export const api = axios.create();
api.defaults.timeout = 2000;
