import Vue from 'vue';
import Vuex from 'vuex';

Vue.use(Vuex)

export default new Vuex.Store({
	state: {
		initialized: false,
	},
	mutations: {
	},
	actions: {
		async startApp({ state, commit, dispatch }, payload) { 
			this.state.initialized = true;
			return true;
		},
	},
})
